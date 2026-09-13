import type { Evidence, OrchestrationResult } from "./schemas.js";
import { buildTimeline } from "./pipeline/timeline.js";
import { correlate } from "./pipeline/correlate.js";
import { analyzeRootCause } from "./pipeline/rootcause.js";
import { writeDraft } from "./pipeline/report.js";
import { proposeHardening } from "./pipeline/hardening.js";
import { verifyClaims } from "./verify/citations.js";
import { review as criticReview } from "./verify/critic.js";
import { saveDraft } from "./store.js";
import { newLemmaTelemetry } from "./lemma.js";

/**
 * Orchestrator — runs the full pipeline for one incident.
 *
 * Stage order (Critic ALWAYS last, matching VoyageBlack's design):
 *   evidence (caller-supplied) → timeline → correlate → rootcause → report
 *   → hardening proposal (drafted, not written) → citation verification → critic
 *
 * Publishing (publish/*.ts) is NOT called here — only from the approve
 * handler, after explicit human approval, reading the draft back out of
 * store.ts by id. See notes/05 build architecture, stages 8-9. This
 * includes the hardening PR: proposeHardening() only drafts a regression
 * test here; publish/github-pr.ts opens the actual PR, gated the same as
 * Notion/Linear/Slack.
 */
export async function runPostmortem(
  incidentId: string,
  evidence: Evidence[],
): Promise<OrchestrationResult> {
  const telemetry = newLemmaTelemetry("postmortem-agent");

  try {
    const evidenceById = new Map(evidence.map((e) => [e.artifactId, e]));

    const timeline = buildTimeline(evidence);
    const correlations = correlate(timeline);
    const rootCause = await analyzeRootCause(timeline, correlations);
    const draft = writeDraft({ incidentId, timeline, rootCause });

    // Hardening proposal is a nice-to-have, not core to the postmortem —
    // a failure here shouldn't take down report generation. Logged, not thrown.
    let hardeningProposal: OrchestrationResult["hardeningProposal"];
    try {
      hardeningProposal = await proposeHardening(rootCause, timeline);
    } catch (err) {
      console.warn(`[orchestrator] proposeHardening failed, continuing without it: ${err}`);
    }

    const citationChecks = await verifyClaims(draft.claims, evidenceById);
    const verifiedClaims = draft.claims.filter((claim, i) => {
      const check = citationChecks[i];
      return check?.artifactResolved && check?.supported;
    });
    draft.claims = verifiedClaims;

    const verdict = await criticReview(draft);
    if (verdict.injectionDetected) verdict.approved = false;

    // Self-referential trust footer — a tally of checks already performed,
    // not a new claim. Surfaced in the Notion page and Slack summary.
    const claimsVerified = citationChecks.filter((c) => c.artifactResolved && c.supported).length;
    const verificationStats: OrchestrationResult["verificationStats"] = {
      totalClaimsChecked: citationChecks.length,
      claimsVerified,
      claimsCut: citationChecks.length - claimsVerified,
      evidenceQuarantined: evidence.filter((e) => e.quarantined).length,
    };

    const result: OrchestrationResult = {
      draft,
      citationChecks,
      verdict,
      approved: verdict.approved,
      requiresHumanReview: verdict.requiresHumanReview,
      verificationStats,
      ...(hardeningProposal ? { hardeningProposal } : {}),
    };

    saveDraft(incidentId, result);
    await telemetry.flush();
    return result;
  } catch (err) {
    await telemetry.fail(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    await telemetry.shutdown();
  }
}
