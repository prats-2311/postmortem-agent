import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationResult } from "./schemas.js";

const mockGetDraft = vi.fn();
const mockSaveDraft = vi.fn();
vi.mock("./store.js", () => ({
  getDraft: (id: string) => mockGetDraft(id),
  saveDraft: (id: string, result: unknown) => mockSaveDraft(id, result),
}));

const mockPublishToNotion = vi.fn();
vi.mock("./publish/notion.js", () => ({
  publishToNotion: (...args: unknown[]) => mockPublishToNotion(...args),
}));

const mockFileLinearTickets = vi.fn();
vi.mock("./publish/linear.js", () => ({
  fileLinearTickets: (...args: unknown[]) => mockFileLinearTickets(...args),
}));

const mockPostSummaryToSlack = vi.fn();
vi.mock("./publish/slack-post.js", () => ({
  postSummaryToSlack: (...args: unknown[]) => mockPostSummaryToSlack(...args),
}));

const mockOpenHardeningPR = vi.fn();
vi.mock("./publish/github-pr.js", () => ({
  openHardeningPR: (...args: unknown[]) => mockOpenHardeningPR(...args),
}));

vi.mock("./lemma.js", () => ({
  newLemmaTelemetry: () => ({
    flush: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  }),
}));

const { approveAndPublish } = await import("./approve.js");

function approvedResult(overrides: Partial<OrchestrationResult["draft"]> = {}): OrchestrationResult {
  return {
    draft: {
      incidentId: "INC-142",
      title: "Incident INC-142",
      severity: "HIGH",
      timeline: [],
      claims: [],
      actionItems: ["Add alert rule", "Add regression eval"],
      metrics: {},
      status: "draft",
      ...overrides,
    },
    citationChecks: [],
    verdict: {
      approved: true,
      injectionDetected: false,
      injectionFields: [],
      requiresHumanReview: true,
      riskLevel: "low",
      reasoning: "clean",
      blockedContent: [],
    },
    approved: true,
    requiresHumanReview: true,
    verificationStats: {
      totalClaimsChecked: 1,
      claimsVerified: 1,
      claimsCut: 0,
      evidenceQuarantined: 0,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("approveAndPublish", () => {
  it("throws if no draft exists for the incident", async () => {
    mockGetDraft.mockReturnValue(undefined);
    await expect(approveAndPublish("INC-999")).rejects.toThrow(/no draft found/);
    expect(mockPublishToNotion).not.toHaveBeenCalled();
  });

  it("refuses to publish when the stored verdict is not approved", async () => {
    const result = approvedResult();
    result.verdict.approved = false;
    mockGetDraft.mockReturnValue(result);

    await expect(approveAndPublish("INC-142")).rejects.toThrow(/not approved/);
    expect(mockPublishToNotion).not.toHaveBeenCalled();
  });

  it("refuses to publish when the stored verdict has injectionDetected:true, even if approved is true", async () => {
    const result = approvedResult();
    result.verdict.injectionDetected = true;
    // even if something upstream left approved:true, injection must still block
    result.verdict.approved = true;
    mockGetDraft.mockReturnValue(result);

    await expect(approveAndPublish("INC-142")).rejects.toThrow(/not approved/);
    expect(mockPostSummaryToSlack).not.toHaveBeenCalled();
  });

  it("publishes to all three targets and marks the draft written on full success", async () => {
    mockGetDraft.mockReturnValue(approvedResult());
    mockPublishToNotion.mockResolvedValue({ ok: true, url: "https://notion.so/p1" });
    mockFileLinearTickets.mockResolvedValue([{ ok: true, url: "https://linear.app/x/ENG-1" }]);
    mockPostSummaryToSlack.mockResolvedValue({ ok: true, url: "https://slack.com/archives/C1/p1" });

    const result = await approveAndPublish("INC-142");

    expect(result.published).toBe(true);
    expect(result.needsEscalation).toBe(false);
    expect(result.notion.attempts).toBe(1);
    expect(result.linear).toHaveLength(2); // 2 action items -> 2 Linear calls
    expect(mockFileLinearTickets).toHaveBeenCalledTimes(2);

    const [, savedResult] = mockSaveDraft.mock.calls[0]!;
    expect((savedResult as OrchestrationResult).draft.status).toBe("written");
  });

  it("passes the incidentId only — never the stored draft — as the approve input shape", async () => {
    // This test documents the contract: approveAndPublish's only parameter
    // is the id. There is no code path here that accepts a caller-supplied
    // draft, which is the actual fix for VoyageBlack's vulnerability.
    expect(approveAndPublish.length).toBe(1);
  });

  it("retries a failing publisher up to 3 total attempts, succeeding on the last one", async () => {
    mockGetDraft.mockReturnValue(approvedResult());
    mockPublishToNotion
      .mockResolvedValueOnce({ ok: false, error: "timeout" })
      .mockResolvedValueOnce({ ok: false, error: "timeout" })
      .mockResolvedValueOnce({ ok: true, url: "https://notion.so/p1" });
    mockFileLinearTickets.mockResolvedValue([{ ok: true, url: "u" }]);
    mockPostSummaryToSlack.mockResolvedValue({ ok: true, url: "u" });

    const result = await approveAndPublish("INC-142");

    expect(mockPublishToNotion).toHaveBeenCalledTimes(3);
    expect(result.notion.ok).toBe(true);
    expect(result.notion.attempts).toBe(3);
    expect(result.needsEscalation).toBe(false);
  }, 10000);

  it("marks needsEscalation when a target exhausts all retries, but still attempts the other targets", async () => {
    mockGetDraft.mockReturnValue(approvedResult());
    mockPublishToNotion.mockResolvedValue({ ok: false, error: "permanent failure" });
    mockFileLinearTickets.mockResolvedValue([{ ok: true, url: "u" }]);
    mockPostSummaryToSlack.mockResolvedValue({ ok: true, url: "u" });

    const result = await approveAndPublish("INC-142");

    expect(mockPublishToNotion).toHaveBeenCalledTimes(3); // exhausted all attempts
    expect(result.notion.ok).toBe(false);
    expect(result.needsEscalation).toBe(true);
    expect(result.published).toBe(false);
    // Slack and Linear still got attempted despite Notion's total failure —
    // this is the graceful-degradation behavior, not an all-or-nothing abort.
    expect(mockPostSummaryToSlack).toHaveBeenCalled();
    expect(mockFileLinearTickets).toHaveBeenCalled();

    const [, savedResult] = mockSaveDraft.mock.calls[0]!;
    expect((savedResult as OrchestrationResult).draft.status).toBe("approved"); // not "written"
  }, 10000);

  it("gracefully degrades when a publisher THROWS (e.g. missing credentials) instead of returning ok:false", async () => {
    mockGetDraft.mockReturnValue(approvedResult());
    mockPublishToNotion.mockRejectedValue(new Error("publishToNotion: no API key — set NOTION_API_KEY"));
    mockFileLinearTickets.mockResolvedValue([{ ok: true, url: "u" }]);
    mockPostSummaryToSlack.mockResolvedValue({ ok: true, url: "u" });

    const result = await approveAndPublish("INC-142");

    expect(result.notion.ok).toBe(false);
    expect(result.notion.error).toContain("no API key");
    expect(result.needsEscalation).toBe(true);
    // the thrown error must not have aborted the other targets
    expect(mockPostSummaryToSlack).toHaveBeenCalled();
    expect(mockFileLinearTickets).toHaveBeenCalled();
  }, 10000);

  it("uses the fallback status string in the Slack summary when Notion failed", async () => {
    mockGetDraft.mockReturnValue(approvedResult());
    mockPublishToNotion.mockResolvedValue({ ok: false, error: "down" });
    mockFileLinearTickets.mockResolvedValue([{ ok: true, url: "u" }]);
    mockPostSummaryToSlack.mockResolvedValue({ ok: true, url: "u" });

    await approveAndPublish("INC-142");

    const slackCallArgs = mockPostSummaryToSlack.mock.calls[0]!;
    expect(slackCallArgs[1]).toContain("Notion publish failed");
  }, 10000);

  it("skips the hardening PR entirely when no proposal was drafted", async () => {
    mockGetDraft.mockReturnValue(approvedResult()); // no hardeningProposal field
    mockPublishToNotion.mockResolvedValue({ ok: true, url: "u" });
    mockFileLinearTickets.mockResolvedValue([{ ok: true, url: "u" }]);
    mockPostSummaryToSlack.mockResolvedValue({ ok: true, url: "u" });

    const result = await approveAndPublish("INC-142");

    expect(mockOpenHardeningPR).not.toHaveBeenCalled();
    expect(result.hardeningPR).toBeUndefined();
    expect(result.needsEscalation).toBe(false);
  });

  it("opens the hardening PR when a proposal exists, and includes it in the result", async () => {
    const withProposal: OrchestrationResult = {
      ...approvedResult(),
      hardeningProposal: {
        description: "test",
        filePath: "tests/test_x.py",
        fileContent: "def test_x(): ...",
        prTitle: "test: x",
      },
    };
    mockGetDraft.mockReturnValue(withProposal);
    mockPublishToNotion.mockResolvedValue({ ok: true, url: "u" });
    mockFileLinearTickets.mockResolvedValue([{ ok: true, url: "u" }]);
    mockPostSummaryToSlack.mockResolvedValue({ ok: true, url: "u" });
    mockOpenHardeningPR.mockResolvedValue({ ok: true, url: "https://github.com/x/y/pull/9" });

    const result = await approveAndPublish("INC-142");

    expect(mockOpenHardeningPR).toHaveBeenCalledWith(withProposal.hardeningProposal, "INC-142");
    expect(result.hardeningPR).toEqual({ ok: true, url: "https://github.com/x/y/pull/9", attempts: 1 });
    expect(result.needsEscalation).toBe(false);
  });

  it("marks needsEscalation when the hardening PR fails, without blocking the other publishers", async () => {
    const withProposal: OrchestrationResult = {
      ...approvedResult(),
      hardeningProposal: {
        description: "test",
        filePath: "tests/test_x.py",
        fileContent: "def test_x(): ...",
        prTitle: "test: x",
      },
    };
    mockGetDraft.mockReturnValue(withProposal);
    mockPublishToNotion.mockResolvedValue({ ok: true, url: "u" });
    mockFileLinearTickets.mockResolvedValue([{ ok: true, url: "u" }]);
    mockPostSummaryToSlack.mockResolvedValue({ ok: true, url: "u" });
    mockOpenHardeningPR.mockResolvedValue({ ok: false, error: "permanent failure" });

    const result = await approveAndPublish("INC-142");

    expect(result.hardeningPR?.ok).toBe(false);
    expect(result.needsEscalation).toBe(true);
    expect(mockPostSummaryToSlack).toHaveBeenCalled(); // not blocked by the PR failure
  }, 10000);
});
