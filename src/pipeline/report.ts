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
      citedArtifactId: params.rootCause.citedArtifactIds[0]!,
    },
  ];

  return {
    incidentId: params.incidentId,
    title: `Incident ${params.incidentId} — ${params.rootCause.primaryCause.slice(0, 60)}`,
    severity: "HIGH",
    timeline: params.timeline,
    rootCause: params.rootCause,
    claims,
    actionItems: [],
    metrics: {},
    status: "draft",
  };
}
