import type { PublishResult } from "./notion.js";
import type { HardeningProposal } from "../schemas.js";

const GITHUB_HEADERS_BASE = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

async function writeJson<T>(
  url: string,
  method: "POST" | "PUT",
  headers: Record<string, string>,
  body: unknown,
): Promise<T> {
  const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

/**
 * Open a real PR proposing the hardening regression test HardeningProposer
 * drafted. Creates a branch off the repo's current default branch tip,
 * writes the test file via the Contents API, opens the PR — does NOT
 * merge it. A human reviews and merges separately; this publisher's job is
 * "propose," not "ship," which is a deliberately smaller blast radius than
 * the Notion/Linear/Slack publishers (those write a document/ticket/message;
 * this one only ever proposes a code change for human review).
 *
 * POSTCONDITION READ-BACK: after opening the PR, a separate GET re-fetches
 * it and confirms it's actually open before returning ok:true — same
 * pattern as every other publisher.
 */
export async function openHardeningPR(
  proposal: HardeningProposal,
  incidentId: string,
  options?: { repo?: string; authToken?: string },
): Promise<PublishResult> {
  const token = options?.authToken ?? process.env.GITHUB_TOKEN;
  const repo = options?.repo ?? process.env.GITHUB_REPO;
  if (!token) {
    throw new Error("openHardeningPR: no auth token — set GITHUB_TOKEN or pass authToken");
  }
  if (!repo) {
    throw new Error("openHardeningPR: no repo — set GITHUB_REPO or pass repo");
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`openHardeningPR: repo must be "owner/name", got "${repo}"`);
  }

  const headers = { ...GITHUB_HEADERS_BASE, Authorization: `Bearer ${token}` };

  const repoInfo = await fetchJson<{ default_branch: string }>(
    `https://api.github.com/repos/${owner}/${name}`,
    headers,
  );
  const defaultBranch = repoInfo.default_branch;

  const ref = await fetchJson<{ object: { sha: string } }>(
    `https://api.github.com/repos/${owner}/${name}/git/ref/heads/${defaultBranch}`,
    headers,
  );

  const branchName = `hardening/${incidentId.toLowerCase()}-${Date.now()}`;
  await writeJson(`https://api.github.com/repos/${owner}/${name}/git/refs`, "POST", headers, {
    ref: `refs/heads/${branchName}`,
    sha: ref.object.sha,
  });

  await writeJson(
    `https://api.github.com/repos/${owner}/${name}/contents/${proposal.filePath}`,
    "PUT",
    headers,
    {
      message: proposal.prTitle,
      content: Buffer.from(proposal.fileContent, "utf-8").toString("base64"),
      branch: branchName,
    },
  );

  const pr = await writeJson<{ number: number; html_url: string }>(
    `https://api.github.com/repos/${owner}/${name}/pulls`,
    "POST",
    headers,
    {
      title: proposal.prTitle,
      head: branchName,
      base: defaultBranch,
      body:
        `${proposal.description}\n\n` +
        `Auto-proposed by the postmortem agent for ${incidentId}. ` +
        `This PR is NOT auto-merged — please review the test before merging.`,
    },
  );

  const verify = await fetchJson<{ state: string }>(
    `https://api.github.com/repos/${owner}/${name}/pulls/${pr.number}`,
    headers,
  );
  if (verify.state !== "open") {
    return { ok: false, error: "postcondition check failed: PR not open after creation" };
  }

  return { ok: true, url: pr.html_url };
}
