# Lemma — Architecture & Data Model

> Source: docs.uselemma.ai (platform + reference/trace-contract), Sep 2026

## Entity hierarchy

```
Organization                      (Slack OAuth, Linear OAuth, org API keys)
└── Project                       (traces, issues, artifacts, settings, project API key + project ID)
    ├── Agent                     (NOT registered — it's just trace.name; scopes artifacts/analytics/issues)
    ├── Trace                     (one agent execution; 14-day list retention)
    │   └── Spans                 (typed: span | generation | tool; nested via parent_id)
    ├── Issue                     (grouped failure pattern; open→in_progress→resolved|dismissed)
    └── Artifacts                 (provided context + generated understanding doc + decision-flow diagram)
```

Key design choices:
- **Agents are emergent, not registered.** An "agent" exists because named traces arrived. No app registry.
- **Projects isolate environments** (dev/staging/prod = separate projects, separate API keys).
- **Thread** = conversation. Each turn is its own trace; same `thread_id` stitches them.
- Scope table: org owns OAuth connections; project owns channels/webhooks/data; person owns Linear
  identity mapping (API keys have no personal identity).

## Pipeline: how a trace becomes an issue

```
agent code ──SDK──> POST /traces/ingest (JSON tree, one complete delivery per execution)
                     │  201 = accepted; server generates missing IDs; synthetic root span {traceId}:root
                     v
                 stored spans ──> trace marked READY (openable in dashboard)
                     v
                 extraction runs AFTER thread goes quiet (immediately if no thread_id)
                     │  audits trace vs instructions + artifact context; probabilistic
                     v
                 evidence grouped into ISSUE (accumulates supporting traces on recurrence)
                     v
                 routing: Slack alert / Issue Brief / Linear ticket (manual) / MCP / webhook
```

Critical semantics:
- **One agent execution = one trace.** Root record + all child work in `trace.spans[]`.
- **Ingest is one-shot, not a merge API.** Deliver the complete tree when the turn finishes.
  No field-level upsert; omitted fields don't preserve prior values. Re-sending the same payload
  is idempotent (existing span IDs skipped). Processing runs once — late re-delivery doesn't re-run extraction.
- **Ready ≠ API key created.** Observability is proven only by an inspectable ready trace.
- Never reuse one `trace.id` across turns.

## The trace contract (POST /traces/ingest)

### Requirement tiers
| Tier | Meaning | Examples |
|---|---|---|
| **Ingest** | required for 201 | valid JSON, `project_id` (UUID), `trace.name`, named spans, unique span IDs |
| **Semantic** | unlocks product features | root input + output-or-error, typed generations/tools, model, nesting, thread/user |
| **High quality** | ideal fidelity | measured durations, complete span I/O, full per-call message history, causal nesting |

### Payload skeleton
```json
{
  "project_id": "uuid",
  "trace": {
    "id": "trace-id", "name": "support-agent",
    "input": "user question", "output": "final answer",
    "thread_id": "conv-42", "user_id": "user-7", "release": "1.8.3",
    "started_at": "...", "ended_at": "...", "duration_ms": 2410,
    "metadata": { "firm.slug": "acme" },
    "spans": [
      { "id": "s1", "name": "retrieve-context", "type": "span", "input": {...}, "output": {...} },
      { "id": "s2", "parent_id": "s1", "name": "search_docs", "type": "tool", "input": {...}, "output": [...] },
      { "id": "s3", "name": "answer", "type": "generation", "model": "gpt-4o",
        "input": [messages...], "output": "...", "usage": { "input_tokens": 1200, "output_tokens": 340 } }
    ]
  }
}
```

### Span types
| type | for | semantic fields |
|---|---|---|
| `span` | retrieval, ranking, planning, app logic | input + output (or error) |
| `generation` | one LLM call | model, full ordered message list (system + history + tools + current), completion, usage |
| `tool` | one tool invocation | name, args, result (or error — never both) |

- Type is a discriminator; setting `model` alone doesn't make a generation.
- `trace.input` = current user turn; generation `input` = the FULL prompt payload for that call.
- Token `usage`: only what the provider returned. Absence vs explicit zero is meaningful to Analytics
  (unsupported vs genuinely empty). Never invent counts; backend computes cost (LiteLLM list prices).

### Errors
- Record failure on the exact span where it happened; keep the input; pass `error`, don't invent output.
- Uncaught exception in callback → root failed, trace still sent, error rethrown.
- Agent recovered? Leave root successful, keep child error. (This maps to their "integration failure" taxonomy.)

### Timing resolution
1. explicit `duration_ms` → 2. `ended_at - started_at` → 3. Lemma allocates remaining parent time
   equally among unmeasured siblings (0 if explicit siblings already exceed parent).
- Root latency and generation duration are **distinct** Analytics quantities — don't conflate.

### Normalization at ingest (don't hand-build these)
`trace.name`→`gen_ai.agent.name`; `thread_id`→`lemma.thread_id`; `user_id`→`user.id`/`enduser.id`;
`type:"generation"`→`openinference.span.kind:"llm"`; `model`→`gen_ai.request.model`;
usage→OTel GenAI names (`gen_ai.usage.*`) + OpenInference compat (`llm.token_count.*`).
Provenance stamps on every span: `lemma.sdk.language`, `lemma.sdk.integration` (manual | vercel-ai | langchain | openai-agents | mastra).

## Delivery semantics & failure behavior

| Path | Behavior on ingest failure |
|---|---|
| `lemma.trace()` callback / `TraceHandle.end()` | **fails open** — logged (debug mode), dropped; never breaks caller's app |
| `lemma.ingest(context)` | **strict** — raises on non-2xx so you can retry the same payload |
| `turn.end()` (cross-process) | **strict** — throws on 4xx/5xx |

## Cross-process turns (host + sandbox = one trace)

For E2B-style sandboxes: host owns root + API key; child records a **journal** locally
(`attachTurn(token)`, never constructs Lemma, never has the API key); host `apply()`s the journal
and ingests **once**. Context token carries `traceId`, `parentSpanId`, `threadId`, `userId`, `startedAt`.
Journals are idempotent (stable span IDs); TS host can apply Python child journals and vice versa.
Unclean sandbox exit: apply partial journal, end sandbox span as ERROR, `turn.fail()`, `turn.end()`.

## Retention & limits

- Traces list: **14 days**. Analytics: **90-day rolling horizon** (chart points can outlive their raw traces).
- `release` field: trimmed; dropped if empty/>200 chars/contains newline-tab-CR. Not guessed.
- Trace delete = dashboard removal only.
- MCP/REST results truncate when oversized → paginate.
