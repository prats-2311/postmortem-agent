import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNotionBlocks, publishToNotion, verificationFooterText } from "./notion.js";
import type { PostmortemDraft, VerificationStats } from "../schemas.js";

const SAMPLE_DRAFT: PostmortemDraft = {
  incidentId: "INC-142",
  title: "Incident INC-142 — silent policy fallback",
  severity: "HIGH",
  timeline: [
    { artifactId: "GH-PR-1", timestamp: "2026-09-13T18:18:00Z", source: "github", summary: "PR #1 merged" },
  ],
  rootCause: {
    primaryCause: "PR #1 renamed the policy slug; fetch_policy silently returned empty on 404.",
    contributingFactors: ["warning-level logging only", "no alert on PolicyFetchError"],
    confidence: 0.9,
    citedArtifactIds: ["GH-PR-1"],
  },
  claims: [{ text: "The agent fabricated a 30-day refund policy.", citedArtifactIds: ["SLK-101"] }],
  actionItems: ["Add alert rule on PolicyFetchError", "Add regression eval for policy citations"],
  metrics: { machineSignalLagMinutes: 45, humanDetectionLagMinutes: 126 },
  status: "approved",
};

const CLEAN_STATS: VerificationStats = {
  totalClaimsChecked: 3,
  claimsVerified: 3,
  claimsCut: 0,
  evidenceQuarantined: 0,
};

const DIRTY_STATS: VerificationStats = {
  totalClaimsChecked: 3,
  claimsVerified: 2,
  claimsCut: 1,
  evidenceQuarantined: 1,
};

describe("verificationFooterText", () => {
  it("renders all three stats in one line", () => {
    expect(verificationFooterText(DIRTY_STATS)).toBe(
      "2/3 claims verified · 1 evidence item(s) quarantined · 1 unsupported claim(s) cut",
    );
  });
});

describe("buildNotionBlocks", () => {
  it("includes root cause, timeline, findings, action items, and metrics", () => {
    const blocks = buildNotionBlocks(SAMPLE_DRAFT, CLEAN_STATS);
    const text = JSON.stringify(blocks);
    expect(text).toContain("PR #1 renamed the policy slug");
    expect(text).toContain("Add alert rule on PolicyFetchError");
    expect(text).toContain("fabricated a 30-day refund policy");
    expect(text).toContain("45m");
  });

  it("puts the verification callout first, with a green check when everything is clean", () => {
    const blocks = buildNotionBlocks(SAMPLE_DRAFT, CLEAN_STATS);
    const first = blocks[0] as unknown as { type: string; callout: { icon: { emoji: string } } };
    expect(first.type).toBe("callout");
    expect(first.callout.icon.emoji).toBe("✅");
  });

  it("uses a warning icon on the callout when something was cut or quarantined", () => {
    const blocks = buildNotionBlocks(SAMPLE_DRAFT, DIRTY_STATS);
    const first = blocks[0] as unknown as { callout: { icon: { emoji: string } } };
    expect(first.callout.icon.emoji).toBe("⚠️");
  });

  it("truncates rich text to Notion's 2000-char limit", () => {
    const longDraft: PostmortemDraft = { ...SAMPLE_DRAFT, actionItems: ["x".repeat(3000)] };
    const blocks = buildNotionBlocks(longDraft, CLEAN_STATS);
    const item = blocks.find((b) => JSON.stringify(b).includes("xxx")) as unknown as {
      bulleted_list_item: { rich_text: { text: { content: string } }[] };
    };
    expect(item.bulleted_list_item.rich_text[0]!.text.content.length).toBeLessThanOrEqual(2000);
  });
});

describe("publishToNotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws without credentials", async () => {
    const orig = process.env.NOTION_API_KEY;
    delete process.env.NOTION_API_KEY;
    await expect(publishToNotion(SAMPLE_DRAFT, CLEAN_STATS, { parentPageId: "p1" })).rejects.toThrow(
      /no API key/,
    );
    if (orig) process.env.NOTION_API_KEY = orig;
  });

  it("creates the page and verifies it via read-back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init?: RequestInit) => {
        const url = input.toString();
        if (init?.method === "POST" && url.endsWith("/pages")) {
          return new Response(
            JSON.stringify({ id: "page-123", url: "https://notion.so/page-123" }),
            { status: 200 },
          );
        }
        if (url.endsWith("/pages/page-123")) {
          return new Response(JSON.stringify({ id: "page-123", archived: false }), { status: 200 });
        }
        throw new Error(`unexpected call: ${url}`);
      }),
    );

    const result = await publishToNotion(SAMPLE_DRAFT, CLEAN_STATS, {
      apiKey: "secret_test",
      parentPageId: "parent-1",
    });
    expect(result).toEqual({ ok: true, url: "https://notion.so/page-123" });
  });

  it("fails cleanly when creation returns a non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 })),
    );
    const result = await publishToNotion(SAMPLE_DRAFT, CLEAN_STATS, { apiKey: "bad", parentPageId: "p1" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  it("fails the postcondition check if the page reads back archived", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init?: RequestInit) => {
        const url = input.toString();
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ id: "page-9", url: "https://notion.so/page-9" }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ id: "page-9", archived: true }), { status: 200 });
      }),
    );
    const result = await publishToNotion(SAMPLE_DRAFT, CLEAN_STATS, { apiKey: "k", parentPageId: "p1" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("postcondition");
  });
});
