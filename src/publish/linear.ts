import type { PublishResult } from "./notion.js";

const LINEAR_API_URL = "https://api.linear.app/graphql";

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function linearRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<LinearGraphQLResponse<T>> {
  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    // Linear's personal API keys go in Authorization directly — no "Bearer " prefix.
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as LinearGraphQLResponse<T>;
  if (!res.ok) {
    throw new Error(`Linear API error ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

interface IssueCreateData {
  issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } | null };
}

async function createLinearIssue(
  title: string,
  incidentId: string,
  apiKey: string,
  teamId: string,
): Promise<PublishResult> {
  const mutation = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }
  `;

  const json = await linearRequest<IssueCreateData>(apiKey, mutation, {
    input: {
      teamId,
      title: title.slice(0, 255),
      description: `Action item from incident ${incidentId} postmortem.`,
    },
  });

  if (json.errors?.length) {
    return { ok: false, error: `Linear issueCreate failed: ${json.errors.map((e) => e.message).join("; ")}` };
  }
  const issue = json.data?.issueCreate.issue;
  if (!json.data?.issueCreate.success || !issue) {
    return { ok: false, error: "Linear issueCreate returned success:false" };
  }

  const verified = await verifyLinearIssue(issue.id, apiKey);
  if (!verified) {
    return { ok: false, error: "postcondition check failed: issue not readable after creation" };
  }

  return { ok: true, url: issue.url };
}

async function verifyLinearIssue(id: string, apiKey: string): Promise<boolean> {
  const query = `query Issue($id: String!) { issue(id: $id) { id } }`;
  const json = await linearRequest<{ issue: { id: string } | null }>(apiKey, query, { id });
  return !!json.data?.issue?.id;
}

/**
 * File each action item as its own Linear issue.
 *
 * POSTCONDITION READ-BACK: after each `issueCreate`, a separate query
 * re-fetches the issue by ID before it's counted as filed — mirrors the
 * Notion publisher's read-back and the same reliability-brief principle.
 *
 * Items are created sequentially, not in parallel, so a failure partway
 * through still returns results for everything attempted so far rather
 * than an all-or-nothing failure.
 *
 * NOT YET LIVE-TESTED — no Linear API key/team set up yet. linear.test.ts
 * covers the create + read-back + error paths with mocked responses.
 */
export async function fileLinearTickets(
  actionItems: string[],
  incidentId: string,
  options?: { apiKey?: string; teamId?: string },
): Promise<PublishResult[]> {
  const apiKey = options?.apiKey ?? process.env.LINEAR_API_KEY;
  const teamId = options?.teamId ?? process.env.LINEAR_TEAM_ID;
  if (!apiKey) {
    throw new Error("fileLinearTickets: no API key — set LINEAR_API_KEY or pass apiKey");
  }
  if (!teamId) {
    throw new Error("fileLinearTickets: no team — set LINEAR_TEAM_ID or pass teamId");
  }

  const results: PublishResult[] = [];
  for (const item of actionItems) {
    results.push(await createLinearIssue(item, incidentId, apiKey, teamId));
  }
  return results;
}
