import { generateObject } from "ai";
import { model } from "../model.js";
import { HardeningProposalSchema, type HardeningProposal, type RootCause, type TimelineEntry } from "../schemas.js";

/**
 * HardeningProposer — "what would have caught this earlier?"
 *
 * Goes beyond recommending in prose: proposes ONE concrete, runnable
 * regression test that would have caught the exact failure mode described
 * in the root cause. Same isolation pattern as RootCauseAnalyzer — receives
 * only structured fields (root cause text, contributing factors, timeline
 * summaries), never raw evidence text.
 *
 * This stage only DRAFTS the proposal — no GitHub write happens here. The
 * actual PR is opened by publish/github-pr.ts, and only after human
 * approval, same as Notion/Linear/Slack. Drafting is free; writing to the
 * world requires the same approval gate as everything else.
 */
export async function proposeHardening(
  rootCause: RootCause,
  timeline: TimelineEntry[],
): Promise<HardeningProposal> {
  const structuredInput = {
    primaryCause: rootCause.primaryCause,
    contributingFactors: rootCause.contributingFactors,
    citedArtifactIds: rootCause.citedArtifactIds,
    timelineSummaries: timeline.map((t) => ({
      artifactId: t.artifactId,
      source: t.source,
      summary: t.summary,
    })),
  };

  const { object } = await generateObject({
    model,
    schema: HardeningProposalSchema,
    system:
      "You are HardeningProposer for an incident postmortem agent. Given a root cause " +
      "analysis, propose ONE concrete regression test (Python, pytest) that would have " +
      "caught this exact failure mode before it reached production. Write real, runnable " +
      "test code in fileContent — not a description of a test. The test must assert the " +
      "SPECIFIC failure behavior in the root cause: if a service silently swallowed an " +
      "error and returned an empty/default result instead of raising, the test should " +
      "assert that the equivalent failure DOES raise (or otherwise fails loudly) instead. " +
      "Keep it self-contained and short — one focused test function, no unnecessary setup.",
    prompt: `Propose a hardening regression test for this incident:\n\n${JSON.stringify(structuredInput, null, 2)}`,
  });

  return object;
}
