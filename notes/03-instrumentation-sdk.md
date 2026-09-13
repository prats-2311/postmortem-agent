# Lemma — SDK & Instrumentation Guide

> Source: docs.uselemma.ai/tracing + /integrations + /guides, Sep 2026

## Install & credentials

```bash
# TypeScript                      # Python
npm install @uselemma/tracing     pip install uselemma-tracing
```

```bash
export LEMMA_API_KEY="lma_..."       # server-side ONLY, never in browser/repo
export LEMMA_PROJECT_ID="proj_..."
export LEMMA_RELEASE="<commit-sha>"  # optional but stamp it; changes per deploy
```

Default endpoint `https://api.uselemma.ai`. There's also a coding-agent skill:
`npx skills add uselemma/lemma --skill "lemma-tracing"`.

## Core pattern (callback form — preferred)

```typescript
import { Lemma } from "@uselemma/tracing";
const lemma = new Lemma();

const answer = await lemma.trace(
  { name: "support-agent", input: userMessage, threadId: conversationId, userId: user.id },
  async (trace) => {
    // span for app work
    const retrieve = trace.startSpan({ name: "retrieve-context", input: { query: userMessage } });
    const docs = await searchDocs(userMessage);
    retrieve.end({ output: { count: docs.length } });

    // tool call (record after it returns → args + result)
    trace.recordTool({ name: "search_docs", input: { query: userMessage }, output: docs, durationMs: 45 });

    // LLM call
    const response = await callModel(userMessage, docs);
    trace.recordGeneration({
      name: "draft-reply", model: "gpt-4o",
      input: response.messages,          // FULL ordered message list incl. system prompt
      output: response.text,
      usage: { inputTokens: 1200, outputTokens: 340 },
      llmProvider: "openai",
    });

    return response.text;               // becomes trace.output automatically
  },
);
```

Python: `lemma.trace("name", run_fn, input=..., thread_id=..., user_id=...)` /
`lemma.async_trace(...)`; snake_case everywhere (`record_tool`, `start_generation`, `parent_id=` explicit for nesting).

## API surface cheat sheet

| Need | TypeScript | Notes |
|---|---|---|
| Root boundary | `lemma.trace({...}, cb)` or handle `lemma.trace({...})` + `trace.end({output})` | callback measures duration automatically |
| App-logic span | `trace.startSpan(...)` → `.end({output})` or `trace.recordSpan(...)` | live handles measure real elapsed time |
| Tool call | `trace.recordTool({name, input, output|error})` / `startTool` | stable boring names: `search_docs`, `lookup_order` |
| LLM call | `trace.recordGeneration({name, model, input, output, usage, llmInputMessages})` | `type` discriminator, not `model`, makes it a generation |
| Errors | throw (auto), `trace.fail(err)`, child `error` field, `.end({error})` | record on the exact failing span; rethrow if run should fail |
| Override output | `trace.output(value)` | when recorded output ≠ return value |
| Nesting | record via span handle (TS auto) / `parent_id` (Py explicit) | preserves causality tree |
| Detached helpers (TS) | `lemma.startSpan({traceId})`, `lemma.recordTool({traceId, parentSpanId})` | warn + no-op if can't attach |
| Build-your-own | `new TraceContext({id, ...})` + `lemma.ingest(context)` | queue workers/backfills; strict errors, retry-safe |
| Cross-process | `startTurn` / `turn.export({parentSpanId})` / `attachTurn(token)` / `turn.apply(journal)` / `turn.end()` | host owns key; child journals locally |
| Multi-turn | new trace per turn + same `threadId` | extraction waits for thread quiet |
| Metadata | `metadata: { "firm.slug": "acme" }` — dotted keys, NOT nested objects | filter `attr.firm.slug:acme` |
| Debug | `LEMMA_DEBUG=1` | for missing/flat/blank traces |

## Framework adapters

All accept `apiKey`, `projectId`, `release` and forward to the client they construct.

### Vercel AI SDK (TS only) — likely hackathon choice
```typescript
import { generateText, tool } from "ai";
import { vercelAI } from "@uselemma/tracing";

const lemmaTelemetry = vercelAI({ apiKey, projectId, release });   // NEW instance per operation!
try {
  const result = await generateText({
    model, prompt, tools: { ... },
    telemetry: {                       // v6: experimental_telemetry
      functionId: "support-agent",     // becomes agent name
      metadata: { threadId, userId },  // promoted to root
      integrations: [lemmaTelemetry],
    },
  });
  await lemmaTelemetry.flush();        // sends the trace
  return result.text;
} catch (e) {
  await lemmaTelemetry.fail(e);        // aborted before terminal callback
  throw e;
} finally {
  await lemmaTelemetry.shutdown();     // serverless/worker teardown
}
```
- One integration object = one in-flight run (concurrent reuse fails fast; sequential OK).
- Records: root (input, final answer/error, thread/user, wall-clock), each model step as generation
  (model, provider, normalized messages incl. system prompt), each tool execution (args, result or error).
- Custom metadata keys: `vercelAI({ threadIdKey: "conversationId", userIdKey: "customerId" })`.
- Attach to existing trace: `vercelAI({ trace })` (integration closes it) or call inside `lemma.trace()` callback.

### Others
- **OpenAI Agents SDK** (TS + Py), **LangChain / LangGraph** (callback handlers, TS + Py), **Mastra** (TS).
- Runnable examples repo: github.com/uselemma/lemma `examples/` — same docs-chat agent per stack;
  `.env` needs `LEMMA_API_KEY`, `LEMMA_PROJECT_ID`, `OPENAI_API_KEY`.

## High-quality trace checklist (what "good" looks like to Lemma)

- [ ] One root per execution; one thread_id per conversation; never reuse trace.id across turns
- [ ] Root has input AND output-or-error
- [ ] Every LLM call = typed generation with model + full message history + completion (+ usage if provider gives it)
- [ ] Every tool call = typed tool with args + result-or-error (never both)
- [ ] Causal nesting via parent_id / span handles
- [ ] Measured durations (live handles preferred); root latency ≠ generation duration
- [ ] `release` stamped (commit SHA) → enables per-release regression tracking
- [ ] user_id where known → per-user slicing
- [ ] Redact secrets/PII before tracing — integrations always record I/O and errors
- [ ] Verify a READY trace in the dashboard (key + SDK install proves nothing)
