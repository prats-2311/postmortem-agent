import type { Evidence, TimelineEntry } from "../schemas.js";

/**
 * TimelineBuilder — merge evidence from all sources into one ordered
 * timeline. Pure transformation, no LLM call needed for ordering itself
 * (sorting by timestamp); an LLM pass may be layered on top to write the
 * human-readable `summary` per entry from `evidence.sanitized`.
 *
 * TODO (Sunday): decide whether summary generation is a cheap LLM call per
 * entry or a single batched call over all evidence.
 */
export function buildTimeline(evidence: Evidence[]): TimelineEntry[] {
  return [...evidence]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((e) => ({
      artifactId: e.artifactId,
      timestamp: e.timestamp,
      source: e.source,
      summary: e.sanitized, // TODO: replace with LLM-written summary
    }));
}
