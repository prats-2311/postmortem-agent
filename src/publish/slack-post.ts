import type { PublishResult } from "./notion.js";
import { verificationFooterText } from "./notion.js";
import type { VerificationStats } from "../schemas.js";

/** The approve payload — deliberately just an id. See store.ts docstring. */
export interface ApprovePayload {
  incidentId: string;
}

/**
 * Post the tl;dr + Notion link to the incident's Slack channel.
 *
 * POSTCONDITION READ-BACK: after posting, a separate `conversations.history`
 * call re-fetches around the returned `ts` and confirms the message is
 * actually there before returning ok:true — matches the Notion/Linear
 * publishers' read-back pattern.
 *
 * Live-verified: this uses the same SLACK_BOT_TOKEN already confirmed
 * working for evidence collection (now also scoped to chat:write).
 */
export async function postSummaryToSlack(
  incidentId: string,
  notionUrl: string,
  stats: VerificationStats,
  options?: { authToken?: string; channelId?: string },
): Promise<PublishResult> {
  const token = options?.authToken ?? process.env.SLACK_BOT_TOKEN;
  const channelId = options?.channelId ?? process.env.SLACK_INCIDENT_CHANNEL_ID;
  if (!token) {
    throw new Error("postSummaryToSlack: no auth token — set SLACK_BOT_TOKEN or pass authToken");
  }
  if (!channelId) {
    throw new Error("postSummaryToSlack: no channel id — set SLACK_INCIDENT_CHANNEL_ID or pass channelId");
  }

  const text =
    `:page_facing_up: Postmortem for *${incidentId}* is ready: ${notionUrl}\n` +
    `> ${verificationFooterText(stats)}`;

  const postRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      username: "postmortem-agent",
      icon_emoji: ":robot_face:",
    }),
  });
  const postJson = (await postRes.json()) as { ok: boolean; ts?: string; error?: string };
  if (!postRes.ok || !postJson.ok) {
    return { ok: false, error: `Slack chat.postMessage failed: ${postJson.error ?? postRes.status}` };
  }

  const ts = postJson.ts!;

  const verifyRes = await fetch(
    `https://slack.com/api/conversations.history?channel=${channelId}&latest=${ts}&inclusive=true&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const verifyJson = (await verifyRes.json()) as { ok: boolean; messages?: { ts: string }[] };
  const found =
    verifyRes.ok &&
    verifyJson.ok &&
    (verifyJson.messages ?? []).some((m) => m.ts === ts);
  if (!found) {
    return { ok: false, error: "postcondition check failed: message not found in history after posting" };
  }

  return { ok: true, url: `https://slack.com/archives/${channelId}/p${ts.replace(".", "")}` };
}
