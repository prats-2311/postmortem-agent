import { generateObject } from "ai";
import { model } from "../model.js";
import type { Correlation } from "./correlate.js";
import { RootCauseLLMSchema, type RootCause, type TimelineEntry } from "../schemas.js";

/**
 * RootCauseAnalyzer — LLM reasoning over STRUCTURED FIELDS ONLY.
 *
 * Ported from VoyageBlack's isolation pattern (notes/07): this stage never
 * receives raw evidence text (Evidence.raw or .sanitized), only timeline
 * entries' ids/timestamps/sources and correlation links. This means even a
 * prompt injection that slipped past sanitize.ts (paraphrased, novel
 * wording) still can't reach the reasoning stage from here — it would have
 * to compromise the structured summary written in timeline.ts first, which
 * is a much smaller, easier-to-audit surface.
 *
 * Every RootCause.citedArtifactIds entry must be an id that actually exists
 * in the timeline passed in — verify/citations.ts checks this mechanically
 * downstream, but a well-behaved prompt should never emit a fabricated id.
 */
export async function analyzeRootCause(
  timeline: TimelineEntry[],
  correlations: Correlation[],
): Promise<RootCause> {
  const structuredInput = {
    entries: timeline.map((t) => ({
      artifactId: t.artifactId,
      timestamp: t.timestamp,
      source: t.source,
      // NOTE: summary only — this is the structured, LLM-written description
      // from timeline.ts, not Evidence.raw. See module docstring above.
      summary: t.summary,
    })),
    correlations,
  };

  const { object } = await generateObject({
    model,
    schema: RootCauseLLMSchema,
    system:
      "You are RootCauseAnalyzer for an incident postmortem agent. " +
      "You receive structured timeline data only, never raw evidence text. " +
      "Identify the primary cause and contributing factors. " +
      "Every citedArtifactIds entry MUST be an artifactId that appears in the " +
      "input data — never invent one.",
    prompt: `Analyze this incident timeline and correlations:\n\n${JSON.stringify(structuredInput, null, 2)}`,
  });

  return object;
}
