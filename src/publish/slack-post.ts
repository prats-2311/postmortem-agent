import type { PublishResult } from "./notion.js";

/**
 * Post the tl;dr + Notion link to the incident's Slack channel, and (build
 * time) render the human-approval message with an Approve button whose
 * payload is the incident id ONLY — never the draft itself (see store.ts).
 *
 * TODO (Sunday): wire up @slack/web-api, SLACK_BOT_TOKEN,
 * SLACK_INCIDENT_CHANNEL_ID.
 */
export async function postSummaryToSlack(
  _incidentId: string,
  _notionUrl: string,
): Promise<PublishResult> {
  throw new Error("postSummaryToSlack: not implemented — wire up Slack API on build day");
}

/** The approve payload — deliberately just an id. See store.ts docstring. */
export interface ApprovePayload {
  incidentId: string;
}
