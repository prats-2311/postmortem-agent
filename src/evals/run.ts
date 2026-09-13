import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runPostmortem } from "../orchestrator.js";
import { scoreResult, type GroundTruth } from "./score.js";
import type { Evidence } from "../schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

/**
 * `npm run eval` — runs every fixture in evals/fixtures/*, scores each
 * against its ground_truth.json, prints the table the demo ends on.
 *
 * Only INC-142 exists so far. Build day TODO: add 7-9 more fixtures per
 * notes/08's guidance — vary root cause, one with no injection, one with
 * two, one with a missing source (tests graceful degradation), one with
 * insufficient evidence (correct answer: "undetermined").
 */
async function main() {
  const incidentIds = readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const rows: Record<string, unknown>[] = [];

  for (const incidentId of incidentIds) {
    const dir = path.join(FIXTURES_DIR, incidentId);
    const evidence: Evidence[] = JSON.parse(readFileSync(path.join(dir, "evidence.json"), "utf-8"));
    const groundTruth: GroundTruth = JSON.parse(
      readFileSync(path.join(dir, "ground_truth.json"), "utf-8"),
    );

    const result = await runPostmortem(incidentId, evidence);
    const score = scoreResult(result, groundTruth, evidence);

    rows.push({
      incident: incidentId,
      timelineRecall: `${(score.timelineRecall * 100).toFixed(0)}%`,
      citationCoverage: `${(score.citationCoverage * 100).toFixed(0)}%`,
      hallucinationRate: `${(score.hallucinationRate * 100).toFixed(0)}%`,
      redHerringAvoided: score.redHerringAvoided,
      injectionQuarantined: score.injectionQuarantined,
      rootCauseOk: score.rootCauseMentionsRequired && score.rootCauseAvoidsForbidden,
    });
  }

  console.table(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
