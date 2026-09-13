import type { TimelineEntry } from "../schemas.js";

export interface Correlation {
  /** artifactIds this correlation links, in causal order where known. */
  linkedArtifactIds: string[];
  relationship: string; // e.g. "deploy introduced error", "commit fixed error"
}

/**
 * CorrelationEngine — cross-source linking (error ↔ commit ↔ conversation),
 * cascade chain. This is where "PR #482 merged at 14:02 → deploy at 14:30 →
 * first bad trace at 14:35" gets recognized as one causal chain instead of
 * three unrelated timeline entries.
 *
 * TODO (Sunday): implement. Likely an LLM pass over the timeline (structured
 * entries only — see rootcause.ts for why raw text never reaches this stage)
 * asking for causal links, or a simpler heuristic pass (temporal proximity +
 * source-type transitions) if time is short. Either way, output must cite
 * real artifactIds already present in the timeline — never invent one.
 */
export function correlate(_timeline: TimelineEntry[]): Correlation[] {
  throw new Error("correlate: not implemented — build day");
}
