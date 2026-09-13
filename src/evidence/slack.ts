import type { Evidence } from "../schemas.js";
import { sanitize } from "../sanitize.js";

export interface FetchSlackEvidenceParams {
  channelId: string;
  /** ISO datetime window to fetch messages within. */
  since: string;
  until: string;
  /** Defaults to process.env.SLACK_BOT_TOKEN. */
  authToken?: string;
}

interface SlackMessage {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  /** Display-name override used for bot-posted messages (chat:write.customize). */
  username?: string;
  text: string;
  ts: string;
}

/**
 * Subtypes that represent administrative/system events, not conversational
 * content — excluded from evidence. Deliberately NOT excluding
 * "bot_message": a message posted via chat.postMessage (including with a
 * `username` override, exactly how our own seeding script posts) carries
 * subtype "bot_message" and IS real content. An earlier blanket
 * `!subtype` filter silently dropped every bot-posted message, discovered
 * via live testing against a real seeded channel — see notes/05.
 */
const SYSTEM_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "pinned_item",
  "unpinned_item",
]);

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  has_more?: boolean;
}

interface SlackUserInfoResponse {
  ok: boolean;
  error?: string;
  user?: {
    name?: string;
    real_name?: string;
    profile?: { display_name?: string; real_name?: string };
  };
}

const SLACK_API_BASE = "https://slack.com/api";

/**
 * Call a Slack Web API method. Slack's API quirk (unlike Sentry/GitHub):
 * it almost always returns HTTP 200 even on failure — the real error lives
 * in the JSON body's `ok`/`error` fields, so both layers must be checked.
 */
async function callSlack<T extends { ok: boolean; error?: string }>(
  method: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const url = new URL(`${SLACK_API_BASE}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack API error (${method}) ${res.status} ${res.statusText}: ${body}`.trim());
  }

  const json = (await res.json()) as T;
  if (!json.ok) {
    throw new Error(`Slack API error (${method}): ${json.error ?? "unknown error"}`);
  }
  return json;
}

function isoToSlackTs(iso: string): string {
  return (new Date(iso).getTime() / 1000).toFixed(6);
}

function slackTsToIso(ts: string): string {
  return new Date(parseFloat(ts) * 1000).toISOString();
}

async function resolveUserLabel(
  userId: string,
  token: string,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(userId);
  if (cached) return cached;

  try {
    const info = await callSlack<SlackUserInfoResponse>("users.info", { user: userId }, token);
    const label =
      info.user?.profile?.display_name ||
      info.user?.profile?.real_name ||
      info.user?.real_name ||
      info.user?.name ||
      userId;
    cache.set(userId, label);
    return label;
  } catch {
    // A single failed user lookup shouldn't break evidence collection —
    // fall back to the raw user ID rather than throwing.
    cache.set(userId, userId);
    return userId;
  }
}

/**
 * Fetch a Slack incident channel's top-level message history in the given
 * window and turn each into typed, sanitized Evidence. This is the most
 * important source to sanitize correctly — the seeded demo scenario
 * (notes/08, SLK-107) deliberately plants a prompt injection inside a pasted
 * customer transcript in this channel. It must be quarantined here, before
 * RootCauseAnalyzer ever sees it.
 *
 * Two calls:
 * 1. `conversations.history` for the messages themselves. `oldest`/`latest`
 *    are Unix timestamps (seconds, fractional), not ISO — converted here.
 * 2. `users.info` per unique message author, cached — Slack's history API
 *    returns only a bare user ID (e.g. "U0123"), never a display name.
 *
 * NOT YET LIVE-TESTED — same caveat as the initial Sentry/GitHub
 * implementations. slack.test.ts covers parsing, the ok:false error path,
 * and user-label resolution with mocked responses in the meantime.
 *
 * Known limitations:
 * - Single page only (`has_more` / cursor pagination not followed) — fine
 *   for a realistic incident window's message volume.
 * - Top-level channel messages only; threaded replies need a separate
 *   `conversations.replies` call per thread, not implemented.
 *
 * Required bot token scopes: `channels:history` (or `groups:history` for a
 * private channel) + `users:read`.
 */
export async function fetchSlackEvidence(params: FetchSlackEvidenceParams): Promise<Evidence[]> {
  const token = params.authToken ?? process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("fetchSlackEvidence: no auth token — set SLACK_BOT_TOKEN or pass authToken");
  }

  const history = await callSlack<SlackHistoryResponse>(
    "conversations.history",
    {
      channel: params.channelId,
      oldest: isoToSlackTs(params.since),
      latest: isoToSlackTs(params.until),
      inclusive: "true",
      limit: "200",
    },
    token,
  );

  const messages = (history.messages ?? []).filter(
    (m) => m.type === "message" && !SYSTEM_SUBTYPES.has(m.subtype ?? "") && (m.text?.length ?? 0) > 0,
  );

  const userLabelCache = new Map<string, string>();
  const evidence: Evidence[] = [];

  for (const msg of messages) {
    // A `username` override (bot-posted, chat:write.customize) is the
    // author's intended display name — prefer it over resolving `user`,
    // which for such messages is often absent or points at the bot itself.
    const userLabel = msg.username
      ? msg.username
      : msg.user
        ? await resolveUserLabel(msg.user, token, userLabelCache)
        : (msg.bot_id ? "bot" : "unknown");

    evidence.push(
      toEvidence({
        artifactId: `SLK-${msg.ts}`,
        timestamp: slackTsToIso(msg.ts),
        user: userLabel,
        text: msg.text,
      }),
    );
  }

  // Slack returns newest-first; sort ascending to match the other sources.
  return evidence.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Turn one raw Slack message into sanitized Evidence. Pure, testable. */
export function toEvidence(raw: {
  artifactId: string;
  timestamp: string;
  user: string;
  text: string;
}): Evidence {
  const rawText = `${raw.user}: ${raw.text}`;
  const { sanitized, quarantined } = sanitize(rawText);
  return {
    artifactId: raw.artifactId,
    source: "slack",
    timestamp: raw.timestamp,
    raw: rawText,
    sanitized,
    quarantined,
    metadata: { user: raw.user },
  };
}
