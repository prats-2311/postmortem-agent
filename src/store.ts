import type { OrchestrationResult } from "./schemas.js";

/**
 * Server-side draft store, keyed by incident id.
 *
 * Fixes a real bug found in VoyageBlack (notes/07): its POST /approve/{id}
 * accepted the full draft in the request body with no server-side store,
 * so a fabricated draft could be approved and written directly. Here, the
 * approve action must go through getDraft(id) — the client sends an id only.
 *
 * In-memory Map is fine for a single hackathon demo process. Swap for Redis
 * if the deploy target ends up being more than one process.
 */
const drafts = new Map<string, OrchestrationResult>();

export function saveDraft(incidentId: string, result: OrchestrationResult): void {
  drafts.set(incidentId, result);
}

export function getDraft(incidentId: string): OrchestrationResult | undefined {
  return drafts.get(incidentId);
}

export function deleteDraft(incidentId: string): void {
  drafts.delete(incidentId);
}
