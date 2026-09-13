import type { PublishResult } from "./notion.js";

/**
 * File action items as Linear tickets.
 *
 * POSTCONDITION READ-BACK: after creating each ticket, re-fetch it and
 * confirm it exists before counting it as filed.
 *
 * TODO (Sunday): wire up @linear/sdk, LINEAR_API_KEY, LINEAR_TEAM_ID.
 */
export async function fileLinearTickets(
  _actionItems: string[],
  _incidentId: string,
): Promise<PublishResult[]> {
  throw new Error("fileLinearTickets: not implemented — wire up Linear API on build day");
}
