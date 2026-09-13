import { afterEach, describe, expect, it, vi } from "vitest";
import { postSummaryToSlack } from "./slack-post.js";
import type { VerificationStats } from "../schemas.js";

const STATS: VerificationStats = {
  totalClaimsChecked: 3,
  claimsVerified: 3,
  claimsCut: 0,
  evidenceQuarantined: 1,
};

function mockFetchRouter(historyHasMessage: boolean) {
  return vi.fn(async (input: URL | string, _init?: RequestInit) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("/chat.postMessage")) {
      return new Response(JSON.stringify({ ok: true, ts: "1789999999.000100" }), { status: 200 });
    }
    if (url.pathname.endsWith("/conversations.history")) {
      return new Response(
        JSON.stringify({
          ok: true,
          messages: historyHasMessage ? [{ ts: "1789999999.000100" }] : [],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected URL: ${url}`);
  });
}

describe("postSummaryToSlack", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws without credentials", async () => {
    const origToken = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    await expect(
      postSummaryToSlack("INC-142", "https://notion.so/x", STATS, { channelId: "C1" }),
    ).rejects.toThrow(/no auth token/);
    if (origToken) process.env.SLACK_BOT_TOKEN = origToken;
  });

  it("posts the message and confirms it via read-back", async () => {
    vi.stubGlobal("fetch", mockFetchRouter(true));

    const result = await postSummaryToSlack("INC-142", "https://notion.so/x", STATS, {
      authToken: "xoxb-test",
      channelId: "C123",
    });

    expect(result.ok).toBe(true);
    expect(result.url).toContain("C123");
  });

  it("includes the incident id, Notion link, and verification footer in the posted text", async () => {
    const fetchMock = mockFetchRouter(true);
    vi.stubGlobal("fetch", fetchMock);

    await postSummaryToSlack("INC-142", "https://notion.so/abc", STATS, {
      authToken: "xoxb-test",
      channelId: "C123",
    });

    const postCall = fetchMock.mock.calls.find((c) => c[0]!.toString().includes("chat.postMessage"))!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(body.text).toContain("INC-142");
    expect(body.text).toContain("https://notion.so/abc");
    expect(body.text).toContain("3/3 claims verified");
    expect(body.text).toContain("1 evidence item(s) quarantined");
  });

  it("fails cleanly when Slack returns ok:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), { status: 200 }),
      ),
    );

    const result = await postSummaryToSlack("INC-142", "https://notion.so/x", STATS, {
      authToken: "xoxb-test",
      channelId: "bad-channel",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("channel_not_found");
  });

  it("fails the postcondition check when the message doesn't show up in history", async () => {
    vi.stubGlobal("fetch", mockFetchRouter(false));

    const result = await postSummaryToSlack("INC-142", "https://notion.so/x", STATS, {
      authToken: "xoxb-test",
      channelId: "C123",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("postcondition");
  });
});
