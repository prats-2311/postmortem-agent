import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runPostmortem } from "./orchestrator.js";
import type { Evidence } from "./schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * `npm run postmortem -- INC-142`
 *
 * Loads evidence from evals/fixtures/<incidentId>/evidence.json (build this
 * on Sunday from the raw per-source fixtures — see notes/08 and
 * evidence/*.ts's toEvidence() helpers) and runs the full pipeline.
 *
 * TODO (Sunday): once real API adapters exist in evidence/*.ts, add a
 * `--live` flag that calls fetchSentryEvidence / fetchSlackEvidence /
 * fetchGitHubEvidence instead of reading the fixture file.
 */
async function main() {
  const incidentId = process.argv[2];
  if (!incidentId) {
    console.error("Usage: npm run postmortem -- <incidentId>");
    process.exit(1);
  }

  const fixturePath = path.join(__dirname, "evals", "fixtures", incidentId, "evidence.json");
  let evidence: Evidence[];
  try {
    evidence = JSON.parse(readFileSync(fixturePath, "utf-8"));
  } catch {
    console.error(`No fixture at ${fixturePath} — build it first (see notes/08).`);
    process.exit(1);
  }

  const result = await runPostmortem(incidentId, evidence);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
