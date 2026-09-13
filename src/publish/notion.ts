import type { PostmortemDraft } from "../schemas.js";

export interface PublishResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * Publish the approved draft to Notion.
 *
 * POSTCONDITION READ-BACK: after creating the page, re-fetch it and confirm
 * the title matches before returning ok:true. This is the mechanism behind
 * the "skipped work" mitigation in the reliability brief (notes/05) — never
 * trust that a write API call succeeding means the write actually landed.
 *
 * TODO (Sunday): wire up @notionhq/client, NOTION_API_KEY, NOTION_PARENT_PAGE_ID.
 */
export async function publishToNotion(_draft: PostmortemDraft): Promise<PublishResult> {
  throw new Error("publishToNotion: not implemented — wire up Notion API on build day");
}
