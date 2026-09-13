# Lemma — MCP Server, Connections & API

> Source: docs.uselemma.ai/connections + /api-reference, Sep 2026

## MCP: two OPPOSITE directions (don't mix)

| Direction | What | When |
|---|---|---|
| **Lemma MCP server** | your coding agent calls Lemma — list traces/issues, inspect evidence, authorized actions | Claude Code / Cursor / Claude Desktop investigating failures |
| **External MCP servers** | Lemma calls tools on a server YOU connect (Settings → External MCP Connections; OAuth or headers; must reach `active`) | give Inspect/analysis extra tools + per-project validation instructions |

### Connecting a coding agent to Lemma MCP

- Endpoint: `https://api.uselemma.ai/mcp/` — Streamable HTTP
- Auth: `Authorization: Bearer <organization_api_key>` (org-level key, shown once at creation)
- Project-scoped tools need a project ID; "activation" is only recorded after a successful project-scoped call

```bash
# Claude Code
claude mcp add --transport http lemma \
  https://api.uselemma.ai/mcp/ \
  --header "Authorization: Bearer your_organization_api_key"
```

Cursor / Claude Desktop: same URL + header in mcpServers JSON config.

### MCP tool surface = REST API surface (one shared operation list)

Oversized results truncate → paginate. Write tools require client-side confirmation.
Typical uses: last N traces with errors, inspect an issue, **export issue as markdown**, create/link Linear ticket.

## REST/MCP operations catalog (from api-reference)

**Projects**: list/create/get/update/reorder; analytics (view discriminator; cost = LiteLLM-price estimates);
briefs settings (get/update: enable + cadence); instrumentation-diagnostics settings/findings; setup status
(stable blocker codes, no credentials exposed).

**Traces**:
- `search-traces-structural` (span/attribute structure) vs `search-trace-evidence` (visible span content) — distinct!
- discover-trace-search-facets; list-dashboard-traces (cursor pagination, has_error/has_issues filters)
- get-trace (`expand=context` → row+stats+spans+issue occurrences bundle); get-trace-by-run-id; list-trace-spans
  (start-time order; `include_attributes/include_events=false` to slim)
- list-thread-traces (scope=all | neighbors); check-ready-traces; check-per-trace-ingest-status
  (enqueued → ingested → ready → not_found); bulk-delete; list-trace-issue-occurrences; list-thread-issue-summaries

**Issues**:
- list (frequency cutoff by default; `expanded=true` for less-common; `include_context=true` for metrics)
- get (validation: status/evidence_summary/validated_at); get-in-bulk (order-preserving, partial-failure tolerant)
- patch (exactly ONE scalar mutation: status | flagged | assignee); start-review (atomic assign+in_progress)
- merge (same-agent; loser dismissed as duplicate, occurrences move); **get-issue-markdown** (export for tickets/coding agents)
- metric-series (30-day zero-filled daily buckets); artifact-context; chat-context (issue + occurrences + per-trace bundles)
- tags (create/attach/detach/delete, normalized names, idempotent); releases (first-observation order, 7-day coverage)
- batch mutations (status/review/flag/assignee/tag; HTTP 200 with item-level failures)

**Insights**: list/get project-scoped insights (with assigned member issues).

**Linear tickets**: inspect connection health; inspect/preview/create/link/unlink per issue; compact states.
**GitHub**: inspect-github-connection (health + last-known repo identity).
**OpenAPI**: https://api.uselemma.ai/openapi.json

## Slack

Two separate setups:
1. **Product integration**: org owner OAuths workspace → project member binds alert channel →
   test message → optionally enable **Issue Briefs** (daily = prior 24h; weekly = prior 7d, sends Mon UTC).
   Alerts follow issue lifecycle only. Never creates Linear tickets.
2. **Lemma support channel**: Slack Connect with the Lemma team; plan-gated; NOT a product alert path.

## Linear

Three scopes must each be set up: org workspace OAuth → project defaults (team required, project optional)
→ personal identity mapping (each member maps only their own account).
- 1 issue ↔ 1 active ticket. Create / exact-link (preview+confirm) / unlink — all **explicit**; nothing auto-files.
- Ticket body = safe summary + backlink; never raw prompts/tool output.
- Sync: reopen-from-evidence → one comment on completed ticket (not reopened); dismiss → requests ticket
  cancellation; Linear `completed` → resolves Lemma issue; recurrence never creates/reopens tickets.

## Webhooks

- Project-scoped, HTTPS only. Events: `issue.created`, `issue.resolved`, `issue.dismissed`, `issue.reopened`.
  (**No `incident.*` events — that shape no longer exists.**)
- Headers: `X-Lemma-Signature` (`sha256=<hex>` HMAC-SHA256 of RAW body), `X-Lemma-Timestamp` (Unix s;
  5-min tolerance vs replay), `X-Lemma-Event` (route on this).
- Envelope: `{ event, timestamp, projectId, issue: { id, status, ... } }`
- Delivery: 2xx within 10s = success; exponential backoff retries; delivery log in settings.
  Signing secret shown once. Verify against raw body (re-serializing breaks HMAC).

```python
expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(expected, signature) and abs(time.time() - float(ts)) <= 300
```

## Choosing a connection

| Next step should be… | Use |
|---|---|
| team sees alerts/digests in a channel | Slack |
| issue becomes a tracked ticket | Linear (explicit) |
| coding agent investigates evidence | Lemma MCP server |
| Lemma needs extra tools | External MCP connection |
| another system reacts to issue lifecycle | Webhooks |
