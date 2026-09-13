import type { TimelineEntry } from "../schemas.js";

export interface Correlation {
  /** artifactIds this correlation links, in causal order where known. */
  linkedArtifactIds: string[];
  relationship: string; // e.g. "deploy introduced error", "commit fixed error"
}

/**
 * CorrelationEngine — cross-source linking (error ↔ commit ↔ conversation),
 * cascade chain.
 *
 * Heuristic implementation: temporal ordering is the correlation signal we
 * have real confidence in — every TimelineEntry already carries a real
 * timestamp from its source (see timeline.ts). Produces:
 * 1. One correlation chaining every artifact in chronological order (the
 *    full cascade).
 * 2. One correlation per adjacent cross-source transition (e.g.
 *    github -> sentry -> slack) — a source change next to a time step is
 *    the strongest cheap signal for "this likely triggered or informed
 *    the next event."
 *
 * This is a heuristic, not causal proof. RootCauseAnalyzer still reasons
 * over it rather than trusting it blindly, same as any other evidence —
 * and it only ever receives artifactIds that are already in the timeline
 * (never invents one), so a wrong correlation can misdirect but can't
 * fabricate a source.
 */
export function correlate(timeline: TimelineEntry[]): Correlation[] {
  if (timeline.length === 0) return [];

  const correlations: Correlation[] = [
    {
      linkedArtifactIds: timeline.map((t) => t.artifactId),
      relationship: "chronological cascade — full incident timeline in order",
    },
  ];

  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1]!;
    const curr = timeline[i]!;
    if (prev.source !== curr.source) {
      correlations.push({
        linkedArtifactIds: [prev.artifactId, curr.artifactId],
        relationship: `${prev.source} -> ${curr.source} transition`,
      });
    }
  }

  return correlations;
}
