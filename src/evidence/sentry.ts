import type { Evidence } from "../schemas.js";
import { sanitize } from "../sanitize.js";

export interface FetchSentryEvidenceParams {
  orgSlug: string;
  projectSlug: string;
  /** ISO datetime window to fetch issues within (Sentry's `start` / `end`). */
  since: string;
  until: string;
  /** Defaults to process.env.SENTRY_AUTH_TOKEN. */
  authToken?: string;
  /** Defaults to https://sentry.io — override for a self-hosted instance. */
  baseUrl?: string;
}

/**
 * Sentry's own response shape for one entry from the project Issues endpoint.
 * Only the fields we actually use are typed — Sentry returns much more.
 * https://docs.sentry.io/api/events/list-a-projects-issues/
 */
interface SentryIssue {
  id: string;
  shortId?: string;
  title: string;
  culprit?: string | null;
  level: string;
  status: string;
  count: string; // Sentry returns this as a numeric string, not a number
  firstSeen: string; // ISO datetime
  lastSeen: string; // ISO datetime
}

/**
 * Fetch Sentry issues (grouped errors, not raw individual events — this
 * matches our fixture shape: one row per distinct problem, with a count and
 * first/last-seen window) for the incident time range, and turn each into
 * typed, sanitized Evidence.
 *
 * Uses GET /api/0/projects/{org}/{project}/issues/ with an empty `query` so
 * resolved AND unresolved issues both come back — an incident postmortem
 * needs everything in the window, not just what's still open.
 *
 * NOT YET LIVE-TESTED: unlike the Lemma integration (verified live against a
 * real project, see notes/05), this has no Sentry credentials to test
 * against yet. The endpoint, auth scheme, and field names below are Sentry's
 * documented, stable public API — but confirm against a real account before
 * the demo. sentry.test.ts covers the parsing logic with a mocked response
 * so at least that half is verified without live creds.
 *
 * Known limitation: single page only (Sentry paginates via a `Link` header,
 * cursor-based, like GitHub). `limit=100` should cover a realistic incident
 * window; add cursor-following if a fixture ever needs more than that.
 */
export async function fetchSentryEvidence(params: FetchSentryEvidenceParams): Promise<Evidence[]> {
  const token = params.authToken ?? process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    throw new Error(
      "fetchSentryEvidence: no auth token — set SENTRY_AUTH_TOKEN or pass authToken",
    );
  }

  const baseUrl = params.baseUrl ?? "https://sentry.io";
  const url = new URL(
    `${baseUrl}/api/0/projects/${params.orgSlug}/${params.projectSlug}/issues/`,
  );
  url.searchParams.set("query", ""); // all statuses, not just is:unresolved
  url.searchParams.set("start", params.since);
  url.searchParams.set("end", params.until);
  url.searchParams.set("sort", "new");
  url.searchParams.set("limit", "100");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sentry API error ${res.status} ${res.statusText}: ${body}`.trim());
  }

  const issues = (await res.json()) as SentryIssue[];

  return issues.map((issue) =>
    toEvidence({
      artifactId: `SEN-${issue.shortId ?? issue.id}`,
      timestamp: issue.firstSeen,
      title: issue.title,
      ...(issue.culprit ? { culprit: issue.culprit } : {}),
      level: issue.level,
      status: issue.status,
      count: issue.count,
      lastSeen: issue.lastSeen,
    }),
  );
}

/** Turn one raw Sentry issue into sanitized Evidence. Pure, testable. */
export function toEvidence(raw: {
  artifactId: string;
  timestamp: string;
  title: string;
  culprit?: string;
  level?: string;
  status?: string;
  count?: string;
  lastSeen?: string;
}): Evidence {
  const parts = [raw.title];
  if (raw.culprit) parts.push(`(${raw.culprit})`);
  const detailBits: string[] = [];
  if (raw.level) detailBits.push(`level: ${raw.level}`);
  if (raw.count) detailBits.push(`count: ${raw.count}`);
  if (raw.lastSeen) detailBits.push(`last seen ${raw.lastSeen}`);
  const rawText =
    detailBits.length > 0 ? `${parts.join(" ")}. ${detailBits.join(". ")}.` : parts.join(" ");

  const { sanitized, quarantined } = sanitize(rawText);

  const metadata: Record<string, string> = {};
  if (raw.level) metadata.level = raw.level;
  if (raw.status) metadata.status = raw.status;
  if (raw.count) metadata.count = raw.count;

  return {
    artifactId: raw.artifactId,
    source: "sentry",
    timestamp: raw.timestamp,
    raw: rawText,
    sanitized,
    quarantined,
    metadata,
  };
}
