import type { Evidence } from "../schemas.js";
import { sanitize } from "../sanitize.js";

export interface FetchGitHubEvidenceParams {
  repo: string; // "owner/name"
  since: string;
  until: string;
  /** Defaults to process.env.GITHUB_TOKEN. */
  authToken?: string;
}

/**
 * GitHub's response shapes for the two endpoints we call. Only fields we use
 * are typed — GitHub returns much more.
 */
interface GitHubPullRequest {
  number: number;
  title: string;
  user: { login: string } | null;
  merged_at: string | null;
}

interface GitHubDeployment {
  id: number;
  ref: string;
  environment: string;
  created_at: string;
  description: string | null;
}

const GITHUB_HEADERS_BASE = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

/**
 * Fetch merged PRs and deployments in the incident window and turn each into
 * typed, sanitized Evidence. Matches fixtures/inc-142/github.json's shape
 * (GH-PR-482, GH-PR-487, GH-DEP-091, GH-DEP-092).
 *
 * Two calls, both windowed client-side (GitHub's list endpoints don't accept
 * a date-range query param the way Sentry's issues endpoint does):
 * - List PRs (state=closed, sorted by update), filter to merged_at in window.
 * - List deployments, filter to created_at in window.
 *
 * Known limitation: single page (per_page=50) on each — fine for a
 * realistic incident window on a normally-active repo; add pagination if a
 * fixture ever needs more.
 *
 * NOT YET LIVE-TESTED — same caveat as the initial Sentry implementation.
 * Field names are GitHub's documented, stable REST API; confirm against a
 * real repo + token before the demo. github.test.ts covers parsing with
 * mocked responses in the meantime.
 *
 * Also note: not every repo has real GitHub Deployment objects — many teams
 * deploy via a platform (Vercel, Railway, etc.) that never calls GitHub's
 * Deployments API. If deploys come back empty on a real repo, that's
 * expected, not a bug — see notes/08 for how the seeded fixture repo should
 * create real deployment records for the demo.
 */
export async function fetchGitHubEvidence(params: FetchGitHubEvidenceParams): Promise<Evidence[]> {
  const token = params.authToken ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("fetchGitHubEvidence: no auth token — set GITHUB_TOKEN or pass authToken");
  }

  const [owner, repo] = params.repo.split("/");
  if (!owner || !repo) {
    throw new Error(`fetchGitHubEvidence: repo must be "owner/name", got "${params.repo}"`);
  }

  const headers = { ...GITHUB_HEADERS_BASE, Authorization: `Bearer ${token}` };
  const sinceMs = new Date(params.since).getTime();
  const untilMs = new Date(params.until).getTime();
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= sinceMs && t <= untilMs;
  };

  const [prs, deployments] = await Promise.all([
    fetchJson<GitHubPullRequest[]>(
      buildUrl(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        state: "closed",
        sort: "updated",
        direction: "desc",
        per_page: "50",
      }),
      headers,
      "pulls",
    ),
    fetchJson<GitHubDeployment[]>(
      buildUrl(`https://api.github.com/repos/${owner}/${repo}/deployments`, { per_page: "50" }),
      headers,
      "deployments",
    ),
  ]);

  const prEvidence = prs
    .filter((pr) => pr.merged_at && inWindow(pr.merged_at))
    .map((pr) =>
      toEvidence({
        artifactId: `GH-PR-${pr.number}`,
        timestamp: pr.merged_at!,
        kind: "pr",
        summary: `PR #${pr.number} "${pr.title}" merged by ${pr.user?.login ?? "unknown"}.`,
      }),
    );

  const deployEvidence = deployments
    .filter((d) => inWindow(d.created_at))
    .map((d) =>
      toEvidence({
        artifactId: `GH-DEP-${d.id}`,
        timestamp: d.created_at,
        kind: "deploy",
        summary: `Deploy to ${d.environment} (${d.ref})${d.description ? `: ${d.description}` : ""}.`,
      }),
    );

  return [...prEvidence, ...deployEvidence];
}

function buildUrl(base: string, params: Record<string, string>): URL {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function fetchJson<T>(url: URL, headers: Record<string, string>, label: string): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API error (${label}) ${res.status} ${res.statusText}: ${body}`.trim());
  }
  return (await res.json()) as T;
}

/** Turn one raw PR/commit/deploy record into sanitized Evidence. Pure, testable. */
export function toEvidence(raw: {
  artifactId: string;
  timestamp: string;
  kind: "pr" | "commit" | "deploy";
  summary: string;
}): Evidence {
  const { sanitized, quarantined } = sanitize(raw.summary);
  return {
    artifactId: raw.artifactId,
    source: "github",
    timestamp: raw.timestamp,
    raw: raw.summary,
    sanitized,
    quarantined,
    metadata: { kind: raw.kind },
  };
}
