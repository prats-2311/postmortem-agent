import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Claim, CitationCheck, Evidence } from "../schemas.js";

/**
 * CitationVerifier — two checks per claim, mechanical first:
 *
 * 1. Does citedArtifactId actually exist in the evidence store? (code, not
 *    LLM — this is the check VoyageBlack never implemented; its prompt
 *    *asked* for event_id citations but nothing verified them mechanically.
 *    See notes/07, weakness #4.)
 * 2. Does that artifact's content actually support the claim? (one LLM call)
 *
 * A claim that fails either check should be cut from the report before it
 * ever reaches a human — see report.ts / the orchestrator for where the cut
 * happens.
 */
export async function verifyClaims(
  claims: Claim[],
  evidenceById: Map<string, Evidence>,
): Promise<CitationCheck[]> {
  const results: CitationCheck[] = [];

  for (const claim of claims) {
    const artifact = evidenceById.get(claim.citedArtifactId);

    if (!artifact) {
      results.push({
        claim,
        artifactResolved: false,
        supported: false,
        reason: `citedArtifactId "${claim.citedArtifactId}" does not exist in the evidence store`,
      });
      continue;
    }

    const supported = await checkSupport(claim, artifact);
    results.push({ claim, artifactResolved: true, ...supported });
  }

  return results;
}

async function checkSupport(
  claim: Claim,
  artifact: Evidence,
): Promise<{ supported: boolean; reason: string }> {
  const { object } = await generateObject({
    model: anthropic("claude-sonnet-5"),
    schema: z.object({ supported: z.boolean(), reason: z.string() }),
    system:
      "You verify whether a cited piece of evidence actually supports a claim. " +
      "Be strict: paraphrase drift is fine, contradiction or unrelated content is not.",
    prompt:
      `Claim: "${claim.text}"\n\n` +
      `Cited evidence (${artifact.source}, ${artifact.artifactId}):\n"${artifact.sanitized}"\n\n` +
      "Does the evidence support the claim?",
  });
  return object;
}
