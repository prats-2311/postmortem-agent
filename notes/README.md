# Lemma Research Notes

Deep-dive on Lemma (uselemma.ai) — hackathon host and AI-agent observability platform.
Compiled 2026-09-10 from docs.uselemma.ai (33 pages), uselemma.ai, and their blog.

| File | Contents |
|---|---|
| [01-lemma-overview.md](01-lemma-overview.md) | Who they are, the problem (silent agent failures), the 7-failure taxonomy, how the product loop works, feature map, explicit product boundaries |
| [02-architecture.md](02-architecture.md) | Entity model (org→project→agent/trace/issue/artifact), trace→issue pipeline, the full trace contract (`POST /traces/ingest`), delivery semantics, cross-process turns, retention |
| [03-instrumentation-sdk.md](03-instrumentation-sdk.md) | TS/Python SDK usage, API cheat sheet, Vercel AI adapter, high-quality-trace checklist |
| [04-mcp-and-connections.md](04-mcp-and-connections.md) | Lemma MCP server (both directions), full REST/MCP operations catalog, Slack, Linear, webhooks with HMAC verification |
| [05-hackathon-playbook.md](05-hackathon-playbook.md) | How to apply all of this Sunday: postmortem-agent plan, reliability brief mapped to their taxonomy, stack choices, pre-work checklist, registration answers, **and live-tested findings on Lemma's actual detection behavior (2026-09-11)** |
| [06-shipsafe-repo-ideas.md](06-shipsafe-repo-ideas.md) | Ideas mined from shipsafe-ai/shipsafe-shared — VoyageBlack (prior postmortem agent) pipeline, Critic/approval-gate/injection-isolation patterns, demo-craft playbook |
| [07-voyageblack-critic-analysis.md](07-voyageblack-critic-analysis.md) | Deep dive on VoyageBlack's Critic code — two-layer design, fail-closed paths, two real bugs found (fail-open verdict defaults, trusting client drafts), TypeScript port plan |
| [08-demo-incident-fixtures.md](08-demo-incident-fixtures.md) | Seeded demo incident "INC-142: The Phantom Refund Policy" — full cross-source fixtures (Sentry/Slack/GitHub/Lemma), injection plant, red herring, eval ground truth, prior postmortem, scenario B |
| [09-demo-video-script.md](09-demo-video-script.md) | Timestamped ≤2-minute submission video script — tab order, exact narration, real artifact links (Notion/Linear/Slack/PR), what to cut if short on time |

Raw doc mirrors live in the session scratchpad (`lemma-docs/`); re-fetch anytime from
`https://docs.uselemma.ai/llms.txt` (each page is served as raw `.md`).
