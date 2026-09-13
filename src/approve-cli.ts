import "dotenv/config";
import { approveAndPublish } from "./approve.js";

/**
 * `npm run approve -- INC-142`
 *
 * Deliberately takes ONLY an incident id — this mirrors what a real Slack
 * "Approve" button payload would send. There is no flag or argument that
 * accepts a draft; approveAndPublish always loads it server-side. See
 * approve.ts's docstring and notes/07 for why that distinction is the
 * whole point.
 *
 * The draft must already exist in the in-memory store, which means this
 * only works in the same process that ran `npm run postmortem -- <id>`.
 * TODO (build day, if time allows): swap store.ts's in-memory Map for
 * something that survives across processes (a file, Redis, a real DB) so
 * `postmortem` and `approve` can run as separate CLI invocations.
 */
async function main() {
  const incidentId = process.argv[2];
  if (!incidentId) {
    console.error("Usage: npm run approve -- <incidentId>");
    process.exit(1);
  }

  const result = await approveAndPublish(incidentId);
  console.log(JSON.stringify(result, null, 2));

  if (result.needsEscalation) {
    console.error("\n⚠ needsEscalation: true — at least one publish target never succeeded.");
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
