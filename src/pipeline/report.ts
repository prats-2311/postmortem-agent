import type { Claim, PostmortemDraft, RootCause, TimelineEntry } from "../schemas.js";

export interface WriteDraftParams {
  incidentId: string;
  timeline: TimelineEntry[];
  rootCause: RootCause;
  similarIncidents?: { artifactId: string; title: string; similarityScore: number }[];
}

/**
 * ReportWriter — assembles the PostmortemDraft. Every sentence worth
 * standing behind becomes a Claim with a citedArtifactId; verify/citations.ts
 * checks each one mechanically before the draft reaches the Critic.
 *
 * TODO (Sunday):
 * - Draft the title/severity/actionItems (likely one more LLM call, again
 *   over structured timeline + rootCause only — keep the isolation pattern).
 * - Compute metrics (machineSignalLagMinutes etc.) from real timestamps —
 *   see notes/08-demo-incident-fixtures.md ground_truth.required_metrics
 *   for the exact numbers the eval suite checks against.
 * - (Stretch) similar-incident recall — see notes/08's seeded prior
 *   postmortem (INC-097).
 */
export function writeDraft(params: WriteDraftParams): PostmortemDraft {
  const claims: Claim[] = [
    {
      text: params.rootCause.primaryCause,
      citedArtifactIds: params.rootCause.citedArtifactIds,
    },
  ];

  // One action item per contributing factor — gives the Linear publish step
  // real content instead of an empty list. Derived from what RootCauseAnalyzer
  // already produced rather than inventing new content.
  const actionItems = params.rootCause.contributingFactors.map((factor) => `Address: ${factor}`);

  // Total duration is the one metric computable from data we always have
  // (first -> last timeline timestamp). Machine-signal-lag / human-detection-lag
  // need labeled event types the pipeline doesn't tag yet — left for later.
  const metrics: PostmortemDraft["metrics"] = {};
  if (params.timeline.length >= 2) {
    const first = new Date(params.timeline[0]!.timestamp).getTime();
    const last = new Date(params.timeline[params.timeline.length - 1]!.timestamp).getTime();
    metrics.totalDurationMinutes = Math.round((last - first) / 60000);
  }

  return {
    incidentId: params.incidentId,
    title: `Incident ${params.incidentId} — ${params.rootCause.primaryCause.slice(0, 60)}`,
    severity: "HIGH",
    timeline: params.timeline,
    rootCause: params.rootCause,
    claims,
    actionItems,
    metrics,
    status: "draft",
  };
}
