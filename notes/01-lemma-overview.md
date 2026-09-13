# Lemma — Overview: Problem, Solution, Features

> Sources: uselemma.ai, docs.uselemma.ai, blog posts (Sep 2026)

## Who they are

- **Lemma (uselemma.ai)** — observability & evaluation platform for AI agents in production.
- Founders: Jerry Zhang (CEO, ex Tandem/Chipstack), Cole Gawin. **Y Combinator Fall 2025**, $2.3M pre-seed (Aug 2026).
- SOC 2 Type II, AES-256 at rest, TLS 1.2+, per-org data isolation.
- Co-host of the Multi-App AI Agent Hackathon (Sep 13, 2026).

## The problem they solve

**AI agents fail silently.** Traditional monitoring (uptime, latency, error rates, crashes) catches
explicit errors but misses agents that:

- return confidently *incorrect* answers
- forget earlier messages in a conversation
- choose the wrong tool or misunderstand the task
- appear "successful" while violating intended behavior

Teams are left manually sifting through traces or maintaining brittle hand-written evals.

### Their failure taxonomy (from the blog — judges' mental model)

Seven silent failure modes, judged against 4 reference points (task instructions, run history,
established facts, user understanding):

1. **Skipped work** — agent acknowledges a task, reports success, never does it
2. **Out-of-scope work** — actions nobody asked for
3. **Instruction violation** — breaks explicit rules in system prompt / earlier messages
4. **Integration failure** — tool call errors with no visible recovery behavior
5. **Retry loop** — identical failing attempts repeated; quadratic cost growth
6. **Hallucination** — asserts facts unsupported by context or tool responses
7. **Communication failure** — work done correctly but conveyed so badly it looks broken

## How they solve it (the loop)

1. **Instrument** — SDK wraps each agent execution into one inspectable **trace** (root + child spans).
2. **Analyze** — after a conversation goes quiet (or immediately if no thread), Lemma audits completed
   traces against the agent's instructions/context for behavior that materially hurt the task.
   *No hand-written assertions needed. Detection is probabilistic — issues are hypotheses backed by evidence.*
3. **Group** — repeated evidence is clustered into an **issue** (one issue per underlying defect, revised as traces arrive).
4. **Investigate & route** — dashboard, Inspect (in-product AI assistant), Slack alerts/briefs,
   Linear tickets, Lemma MCP server (coding agents), signed webhooks.
5. **Learn** — real-world failures become evaluation metrics; matching evidence can reopen resolved issues (never dismissed ones).

Positioning (from "Introducing Lemma" blog): an **adaptation layer** — infrastructure so agents learn
from their own mistakes; the vision is "continual learning systems," not just better models.

## Feature map

| Surface | What it does |
|---|---|
| **Traces** | Search/filter/inspect ready executions; conversation view + execution tree; 14-day retention |
| **Issues** | Auto-grouped recurring failure patterns; statuses open / in_progress / resolved / dismissed; priority from recurrence+impact; markdown export |
| **Inspect** | Page-aware in-product AI assistant grounded in the project's traces/issues/artifacts; sharable conversations |
| **Artifacts** | Per-agent context you provide + Lemma-generated *understanding document* and *decision-flow diagram* (versioned) |
| **Analytics** | Feature-gated; volume, p50/p95 latency, errors, tools, models, estimated cost; 90-day horizon; per-agent scorecards |
| **Slack** | Issue alerts + optional Issue Briefs (daily / weekly-Mon-UTC digests) to a project channel |
| **Linear** | Explicit create/link/unlink of tickets from issues (1:1, never automatic) |
| **Lemma MCP server** | Coding agents (Claude Code, Cursor) query traces/issues, export markdown, act on issues |
| **External MCP** | Reverse direction — Lemma calls tools on servers YOU connect, used by Inspect/analysis |
| **Webhooks** | Signed HMAC-SHA256 POSTs on issue.created / resolved / dismissed / reopened |

## Explicit product boundaries (from docs — important!)

- Evaluates **production usage only**. No offline evaluation ("online eval" = evaluating real prod usage).
- **No standalone monitors, no incidents product, no standalone metrics product.**
- Webhooks: `incident.*` events don't exist ("if you find incident-named events in older samples, they're stale").
- Alerting strictly follows the **issue lifecycle**.
- Nothing auto-files Linear tickets, ever.

**Hackathon implication:** an incident-report/postmortem agent does NOT overlap Lemma's surface —
their docs explicitly disclaim incidents. See [05-hackathon-playbook.md](05-hackathon-playbook.md).

## Supported stacks

- SDKs: **TypeScript** (`@uselemma/tracing`), **Python** (`uselemma-tracing`)
- Framework adapters: OpenAI Agents SDK, Vercel AI SDK (TS only), LangChain, LangGraph, Mastra (TS only)
- Migration paths documented from: Raindrop, Langfuse, OpenTelemetry (side-by-side, not replacement)
- Runnable examples: github.com/uselemma/lemma `examples/` — same docs-chat agent in every stack
