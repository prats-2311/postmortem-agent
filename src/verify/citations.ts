import { generateObject } from "ai";
import { model } from "../model.js";
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
    const artifacts: Evidence[] = [];
    const missing: string[] = [];
    for (const id of claim.citedArtifactIds) {
      const artifact = evidenceById.get(id);
      if (artifact) artifacts.push(artifact);
      else missing.push(id);
    }

    if (missing.length > 0) {
      results.push({
        claim,
        artifactResolved: false,
        supported: false,
        reason: `citedArtifactIds not found in the evidence store: ${missing.join(", ")}`,
      });
      continue;
    }

    const supported = await checkSupport(claim, artifacts);
    results.push({ claim, artifactResolved: true, ...supported });
  }

  return results;
}

async function checkSupport(
  claim: Claim,
  artifacts: Evidence[],
): Promise<{ supported: boolean; reason: string }> {
  const evidenceBlock = artifacts
    .map((a) => `(${a.source}, ${a.artifactId}):\n"${a.sanitized}"`)
    .join("\n\n");
  const { object } = await generateObject({
    model,
    schema: z.object({ supported: z.boolean(), reason: z.string() }),
    system:
      "You verify whether cited evidence actually supports a claim. The claim may draw on " +
      "multiple pieces of evidence together — supported if the COMBINATION of all cited " +
      "evidence backs it. Be strict: paraphrase drift is fine, contradiction or unrelated " +
      "content is not.",
    prompt: `Claim: "${claim.text}"\n\nCited evidence:\n${evidenceBlock}\n\nDoes the evidence support the claim?`,
  });
  return object;
}
