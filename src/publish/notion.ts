import type { PostmortemDraft, VerificationStats } from "../schemas.js";

export interface PublishResult {
  ok: boolean;
  url?: string;
  error?: string;
}

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
// Notion enforces a 2000-char cap per rich_text content string.
const RICH_TEXT_LIMIT = 2000;

interface NotionBlock {
  object: "block";
  type: string;
  [key: string]: unknown;
}

function richText(text: string) {
  return [{ type: "text", text: { content: text.slice(0, RICH_TEXT_LIMIT) } }];
}

function heading2(text: string): NotionBlock {
  return { object: "block", type: "heading_2", heading_2: { rich_text: richText(text) } };
}

function paragraph(text: string): NotionBlock {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(text) } };
}

function bulletedItem(text: string): NotionBlock {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: richText(text) },
  };
}

function callout(text: string, emoji: string): NotionBlock {
  return {
    object: "block",
    type: "callout",
    callout: { rich_text: richText(text), icon: { type: "emoji", emoji } },
  };
}

/**
 * The verification summary — placed FIRST, not last, despite the "footer"
 * name it goes by conversationally (a self-check tally reads better as the
 * first thing seen than buried at the bottom). A tally of checks already
 * performed (citation resolution + support-check + injection quarantine at
 * ingestion), not a new claim the report makes about itself. Green check if
 * every claim survived verification and nothing was cut; yellow warning if
 * something was — visible proof the pipeline is actually checking itself,
 * not just asserting reliability in prose.
 */
export function verificationFooterText(stats: VerificationStats): string {
  const parts = [
    `${stats.claimsVerified}/${stats.totalClaimsChecked} claims verified`,
    `${stats.evidenceQuarantined} evidence item(s) quarantined`,
    `${stats.claimsCut} unsupported claim(s) cut`,
  ];
  return parts.join(" · ");
}

/** Turn a verified PostmortemDraft into Notion page blocks. Pure, testable. */
export function buildNotionBlocks(draft: PostmortemDraft, stats: VerificationStats): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  const allClean = stats.claimsCut === 0 && stats.evidenceQuarantined === 0;
  blocks.push(callout(verificationFooterText(stats), allClean ? "✅" : "⚠️"));

  blocks.push(paragraph(`Severity: ${draft.severity}`));

  if (draft.rootCause) {
    blocks.push(heading2("Root Cause"));
    blocks.push(paragraph(draft.rootCause.primaryCause));
    if (draft.rootCause.contributingFactors.length > 0) {
      blocks.push(heading2("Contributing Factors"));
      for (const factor of draft.rootCause.contributingFactors) blocks.push(bulletedItem(factor));
    }
  }

  if (draft.timeline.length > 0) {
    blocks.push(heading2("Timeline"));
    for (const entry of draft.timeline) {
      blocks.push(bulletedItem(`${entry.timestamp} [${entry.source}] ${entry.summary}`));
    }
  }

  if (draft.claims.length > 0) {
    blocks.push(heading2("Findings"));
    for (const claim of draft.claims) {
      blocks.push(bulletedItem(`${claim.text} (source: ${claim.citedArtifactId})`));
    }
  }

  if (draft.actionItems.length > 0) {
    blocks.push(heading2("Action Items"));
    for (const item of draft.actionItems) blocks.push(bulletedItem(item));
  }

  if (draft.metrics.machineSignalLagMinutes !== undefined) {
    blocks.push(heading2("Metrics"));
    const m = draft.metrics;
    blocks.push(
      paragraph(
        [
          m.machineSignalLagMinutes !== undefined ? `Machine signal lag: ${m.machineSignalLagMinutes}m` : null,
          m.humanDetectionLagMinutes !== undefined ? `Human detection lag: ${m.humanDetectionLagMinutes}m` : null,
          m.timeToMitigateMinutes !== undefined ? `Time to mitigate: ${m.timeToMitigateMinutes}m` : null,
          m.totalDurationMinutes !== undefined ? `Total duration: ${m.totalDurationMinutes}m` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
  }

  return blocks;
}

/**
 * Publish the approved draft to Notion as a new page under NOTION_PARENT_PAGE_ID.
 *
 * POSTCONDITION READ-BACK: after creating the page, GET it back by ID and
 * confirm it's readable and not archived before returning ok:true. This is
 * the mechanism behind the "skipped work" mitigation in the reliability
 * brief (notes/05) — never trust that a write API call returning 200 means
 * the write actually landed and is durable.
 *
 * NOT YET LIVE-TESTED — no Notion integration/credentials set up yet.
 * notion.test.ts covers block-building and the read-back logic with mocks.
 */
export async function publishToNotion(
  draft: PostmortemDraft,
  stats: VerificationStats,
  options?: { apiKey?: string; parentPageId?: string },
): Promise<PublishResult> {
  const apiKey = options?.apiKey ?? process.env.NOTION_API_KEY;
  const parentPageId = options?.parentPageId ?? process.env.NOTION_PARENT_PAGE_ID;
  if (!apiKey) {
    throw new Error("publishToNotion: no API key — set NOTION_API_KEY or pass apiKey");
  }
  if (!parentPageId) {
    throw new Error("publishToNotion: no parent page — set NOTION_PARENT_PAGE_ID or pass parentPageId");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  const title = draft.title || `Incident ${draft.incidentId} Postmortem`;

  const createRes = await fetch(`${NOTION_API_BASE}/pages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      properties: { title: { title: [{ text: { content: title } }] } },
      children: buildNotionBlocks(draft, stats),
    }),
  });
  const createJson = (await createRes.json()) as { id?: string; url?: string; message?: string };
  if (!createRes.ok) {
    return { ok: false, error: `Notion create failed ${createRes.status}: ${JSON.stringify(createJson)}` };
  }

  const pageId = createJson.id!;
  const pageUrl = createJson.url!;

  const verifyRes = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, { headers });
  const verifyJson = (await verifyRes.json()) as { archived?: boolean };
  if (!verifyRes.ok || verifyJson.archived) {
    return { ok: false, error: "postcondition check failed: page not readable (or archived) after creation" };
  }

  return { ok: true, url: pageUrl };
}
