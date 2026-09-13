import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OrchestrationResult } from "./schemas.js";

/**
 * Server-side draft store, keyed by incident id.
 *
 * Fixes a real bug found in VoyageBlack (notes/07): its POST /approve/{id}
 * accepted the full draft in the request body with no server-side store,
 * so a fabricated draft could be approved and written directly. Here, the
 * approve action must go through getDraft(id) — the client sends an id only.
 *
 * File-backed (one JSON file per incident under .store/) rather than an
 * in-memory Map, so `npm run postmortem -- <id>` and `npm run approve -- <id>`
 * work as separate CLI invocations, not just within one process. Swap for
 * Redis/a real DB if the deploy target ends up being more than one machine.
 */
const STORE_DIR = path.join(process.cwd(), ".store");

function draftPath(incidentId: string): string {
  return path.join(STORE_DIR, `${incidentId}.json`);
}

export function saveDraft(incidentId: string, result: OrchestrationResult): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(draftPath(incidentId), JSON.stringify(result), "utf-8");
}

export function getDraft(incidentId: string): OrchestrationResult | undefined {
  const file = draftPath(incidentId);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf-8")) as OrchestrationResult;
}

export function deleteDraft(incidentId: string): void {
  const file = draftPath(incidentId);
  if (existsSync(file)) rmSync(file);
}
