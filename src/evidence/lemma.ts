import type { Evidence } from "../schemas.js";
import { sanitize } from "../sanitize.js";

export interface FetchLemmaEvidenceParams {
  projectId: string;
  since: string;
  until: string;
  /** Defaults to process.env.LEMMA_API_KEY. */
  authToken?: string;
}

/**
 * Lemma's real Issues API response shape, confirmed live against
 * GET /issues?project_id=...&expanded=true before writing this (not
 * guessed) — field is `name`, not `title`.
 */
interface LemmaIssue {
  id: string;
  agent_name?: string;
  name: string;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
}

/**
 * Fetch Lemma issues for the incident window and turn each into typed,
 * sanitized Evidence. Lemma is a natural 6th evidence source specifically
 * when the incident involves an AI agent failure — Lemma's whole product is
 * detecting exactly that category of problem (see notes/01's taxonomy).
 *
 * Uses `expanded=true` to bypass the frequency cutoff (see notes/05's
 * live-tested findings — a single-occurrence issue can otherwise be hidden
 * from the default list).
 *
 * ⚠ Content-relevance caveat, not a code bug: the only real issue currently
 * in this Lemma project is "audit report not provided" — a wrong/hallucinated
 * finding discovered during earlier live-testing (see notes/05), unrelated
 * to the INC-142 refund-policy narrative. The fetcher itself is correct and
 * live-verified; using its real output as demo evidence right now would
 * inject irrelevant content into the INC-142 story. Either dismiss that
 * issue and seed a relevant one before the demo, or don't force Lemma
 * evidence into this particular incident's narrative.
 *
 * NOT YET LIVE-TESTED for the ingestion→toEvidence path — API shape was
 * confirmed via direct curl first; lemma.test.ts covers parsing with mocks.
 */
export async function fetchLemmaEvidence(params: FetchLemmaEvidenceParams): Promise<Evidence[]> {
  const token = params.authToken ?? process.env.LEMMA_API_KEY;
  if (!token) {
    throw new Error("fetchLemmaEvidence: no auth token — set LEMMA_API_KEY or pass authToken");
  }

  const url = new URL("https://api.uselemma.ai/issues");
  url.searchParams.set("project_id", params.projectId);
  url.searchParams.set("expanded", "true");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Lemma API error ${res.status} ${res.statusText}: ${body}`.trim());
  }
  const json = (await res.json()) as { issues: LemmaIssue[] };

  const sinceMs = new Date(params.since).getTime();
  const untilMs = new Date(params.until).getTime();

  return json.issues
    .filter((issue) => {
      const t = new Date(issue.first_seen_at).getTime();
      return t >= sinceMs && t <= untilMs;
    })
    .map((issue) =>
      toEvidence({
        artifactId: `LMA-ISS-${issue.id}`,
        timestamp: issue.first_seen_at,
        name: issue.name,
        status: issue.status,
        occurrenceCount: issue.occurrence_count,
        ...(issue.agent_name ? { agentName: issue.agent_name } : {}),
      }),
    );
}

/** Turn one raw Lemma issue into sanitized Evidence. Pure, testable. */
export function toEvidence(raw: {
  artifactId: string;
  timestamp: string;
  name: string;
  status?: string;
  agentName?: string;
  occurrenceCount?: number;
}): Evidence {
  const detail: string[] = [];
  if (raw.agentName) detail.push(`agent: ${raw.agentName}`);
  if (raw.status) detail.push(`status: ${raw.status}`);
  if (raw.occurrenceCount !== undefined) detail.push(`occurrences: ${raw.occurrenceCount}`);
  const rawText = detail.length > 0 ? `${raw.name}. ${detail.join(". ")}.` : raw.name;

  const { sanitized, quarantined } = sanitize(rawText);

  const metadata: Record<string, string> = {};
  if (raw.status) metadata.status = raw.status;
  if (raw.agentName) metadata.agentName = raw.agentName;

  return {
    artifactId: raw.artifactId,
    source: "lemma",
    timestamp: raw.timestamp,
    raw: rawText,
    sanitized,
    quarantined,
    metadata,
  };
}
