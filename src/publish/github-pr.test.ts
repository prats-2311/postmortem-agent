import { afterEach, describe, expect, it, vi } from "vitest";
import { openHardeningPR } from "./github-pr.js";
import type { HardeningProposal } from "../schemas.js";

const PROPOSAL: HardeningProposal = {
  description: "Asserts fetch_policy raises instead of silently returning empty on a 404.",
  filePath: "tests/test_policy_client_fail_closed.py",
  fileContent: "def test_fetch_policy_raises_on_404():\n    ...\n",
  prTitle: "test: fetch_policy fails closed on 404",
};

function mockGitHubRouter() {
  return vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? "GET";

    if (method === "GET" && /\/repos\/[^/]+\/[^/]+$/.test(url)) {
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
    }
    if (method === "GET" && url.includes("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: "base-sha-123" } }), { status: 200 });
    }
    if (method === "POST" && url.endsWith("/git/refs")) {
      return new Response(JSON.stringify({ ref: "refs/heads/hardening/inc-142-1" }), { status: 201 });
    }
    if (method === "PUT" && url.includes("/contents/")) {
      return new Response(JSON.stringify({ content: { path: PROPOSAL.filePath } }), { status: 201 });
    }
    if (method === "POST" && url.endsWith("/pulls")) {
      return new Response(
        JSON.stringify({ number: 42, html_url: "https://github.com/x/y/pull/42" }),
        { status: 201 },
      );
    }
    if (method === "GET" && url.includes("/pulls/42")) {
      return new Response(JSON.stringify({ state: "open" }), { status: 200 });
    }
    throw new Error(`unexpected call: ${method} ${url}`);
  });
}

describe("openHardeningPR", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws without credentials", async () => {
    const orig = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    await expect(openHardeningPR(PROPOSAL, "INC-142", { repo: "o/r" })).rejects.toThrow(/no auth token/);
    if (orig) process.env.GITHUB_TOKEN = orig;
  });

  it("rejects a malformed repo string", async () => {
    await expect(
      openHardeningPR(PROPOSAL, "INC-142", { repo: "bad-repo-string", authToken: "t" }),
    ).rejects.toThrow(/owner\/name/);
  });

  it("creates a branch, writes the file, opens a PR, and verifies it via read-back", async () => {
    vi.stubGlobal("fetch", mockGitHubRouter());

    const result = await openHardeningPR(PROPOSAL, "INC-142", { repo: "o/r", authToken: "t" });

    expect(result).toEqual({ ok: true, url: "https://github.com/x/y/pull/42" });
  });

  it("never merges — only opens the PR (no merge call is made)", async () => {
    const fetchMock = mockGitHubRouter();
    vi.stubGlobal("fetch", fetchMock);

    await openHardeningPR(PROPOSAL, "INC-142", { repo: "o/r", authToken: "t" });

    const mergeCalls = fetchMock.mock.calls.filter((c) => c[0]!.toString().includes("/merge"));
    expect(mergeCalls).toHaveLength(0);
  });

  it("fails the postcondition check if the PR doesn't read back as open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (method === "GET" && /\/repos\/[^/]+\/[^/]+$/.test(url)) {
          return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
        }
        if (method === "GET" && url.includes("/git/ref/heads/main")) {
          return new Response(JSON.stringify({ object: { sha: "sha" } }), { status: 200 });
        }
        if (method === "POST" && url.endsWith("/git/refs")) {
          return new Response("{}", { status: 201 });
        }
        if (method === "PUT") {
          return new Response("{}", { status: 201 });
        }
        if (method === "POST" && url.endsWith("/pulls")) {
          return new Response(JSON.stringify({ number: 1, html_url: "u" }), { status: 201 });
        }
        if (method === "GET" && url.includes("/pulls/1")) {
          return new Response(JSON.stringify({ state: "closed" }), { status: 200 });
        }
        throw new Error(`unexpected: ${method} ${url}`);
      }),
    );

    const result = await openHardeningPR(PROPOSAL, "INC-142", { repo: "o/r", authToken: "t" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("postcondition");
  });
});
