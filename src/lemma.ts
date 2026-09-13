import "dotenv/config";
import { vercelAI } from "@uselemma/tracing";

/**
 * One fresh vercelAI() integration per pipeline run — per Lemma's docs, one
 * integration object owns one in-flight run; reusing it concurrently fails
 * fast because AI SDK terminal events carry no reliable run ID. Call this
 * once at the start of each `/postmortem` invocation.
 *
 * See notes/03-instrumentation-sdk.md for the full adapter contract.
 */
export function newLemmaTelemetry(functionId: string) {
  return vercelAI({
    apiKey: process.env.LEMMA_API_KEY,
    projectId: process.env.LEMMA_PROJECT_ID,
    release: process.env.LEMMA_RELEASE,
    agentName: functionId,
  });
}

export const LEMMA_AGENT_NAME = "postmortem-agent";
