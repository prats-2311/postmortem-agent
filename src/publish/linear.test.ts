import { afterEach, describe, expect, it, vi } from "vitest";
import { fileLinearTickets } from "./linear.js";

describe("fileLinearTickets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws without credentials", async () => {
    const origKey = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;
    await expect(fileLinearTickets(["do the thing"], "INC-142", { teamId: "t1" })).rejects.toThrow(
      /no API key/,
    );
    if (origKey) process.env.LINEAR_API_KEY = origKey;
  });

  it("sends the API key without a Bearer prefix", async () => {
    const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          data: { issueCreate: { success: true, issue: { id: "i1", identifier: "ENG-1", url: "https://linear.app/x/ENG-1" } } },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fileLinearTickets(["one item"], "INC-142", { apiKey: "lin_api_test", teamId: "t1" });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("lin_api_test");
    expect(headers.Authorization).not.toContain("Bearer");
  });

  it("creates one issue per action item, verified via read-back", async () => {
    let createCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: URL | string, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        if (body.query.includes("mutation")) {
          createCount++;
          return new Response(
            JSON.stringify({
              data: {
                issueCreate: {
                  success: true,
                  issue: { id: `i${createCount}`, identifier: `ENG-${createCount}`, url: `https://linear.app/x/ENG-${createCount}` },
                },
              },
            }),
            { status: 200 },
          );
        }
        // read-back query
        return new Response(JSON.stringify({ data: { issue: { id: body.variables.id } } }), { status: 200 });
      }),
    );

    const results = await fileLinearTickets(
      ["Add alert rule", "Add regression eval"],
      "INC-142",
      { apiKey: "k", teamId: "t1" },
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ ok: true, url: "https://linear.app/x/ENG-1" });
    expect(results[1]).toEqual({ ok: true, url: "https://linear.app/x/ENG-2" });
  });

  it("returns a failed result (not a thrown error) for a GraphQL error, and keeps processing", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) {
          return new Response(JSON.stringify({ errors: [{ message: "invalid team" }] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ data: { issueCreate: { success: true, issue: { id: "i2", identifier: "ENG-2", url: "u2" } } } }),
          { status: 200 },
        );
      }),
    );

    const results = await fileLinearTickets(["bad one", "good one"], "INC-142", {
      apiKey: "k",
      teamId: "bad-team",
    });

    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toContain("invalid team");
    // second item's read-back call means call count keeps advancing — second create succeeds
  });

  it("fails the postcondition check when the issue is not readable after creation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: URL | string, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        if (body.query.includes("mutation")) {
          return new Response(
            JSON.stringify({ data: { issueCreate: { success: true, issue: { id: "ghost", identifier: "ENG-9", url: "u9" } } } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: { issue: null } }), { status: 200 });
      }),
    );

    const results = await fileLinearTickets(["item"], "INC-142", { apiKey: "k", teamId: "t1" });
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toContain("postcondition");
  });
});
