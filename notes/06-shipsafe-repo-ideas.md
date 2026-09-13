# Ideas Mined from shipsafe-ai/shipsafe-shared

> Analyzed 2026-09-10. Repo: github.com/shipsafe-ai/shipsafe-shared (MIT, 51 files, ~9.3k lines,
> docs-heavy). Foundation library for "ShipSafe" — six AI reliability agents built for a June 2026
> multi-partner Devpost hackathon (Gemini/Vertex + ADK + Cloud Run; partner tracks: MongoDB, GitLab,
> Elastic, Fivetran, Arize Phoenix, Dynatrace). Judged Jun 22–Jul 7, 2026.

## What ShipSafe is

Six independent agents, one theme ("AI reliability operating system"), one deterministic demo
scenario (the Hormuz Crisis — strait closes, 14 vessels in transit, all six agents respond).
Uniform internal shape per agent: **ADK Orchestrator → 5 Specialists → Critic (always last) →
human approval gate**, partner MCP as the memory/compute layer, shared OTel telemetry fanned out
to Phoenix + Dynatrace so the capstone agent (AgentOps) observes the fleet without HTTP coupling.

| Agent | Problem | Partner |
|---|---|---|
| CargoDB | decisions with no memory | MongoDB Atlas Vector Search |
| RouteForge | changes that pass review, fail in reality | GitLab |
| **VoyageBlack** | **incidents take 47 min/3 weeks to document** | **Elastic** |
| TideSync | pipelines green while data silently stale | Fivetran |
| NaviGuard | model drift | Arize Phoenix |
| AgentOps | invisible agent fleets | Dynatrace |

## 🎯 Headline finding: VoyageBlack = a validated dry-run of the postmortem agent

Tagline: *"Your worst incident took 3 weeks to document. This takes 90 seconds."*

Its pipeline (from the verified video script):
1. **TimelineBuilder** — queries logs over the incident window, LLM rebuilds ordered timeline
2. **CorrelationEngine** — cross-service error correlation, cascade depth
3. **ImpactCalculator** — raw ES|QL blast radius (services, errors, duration)
4. **RootCauseAnalyzer** — pure LLM, *receives only structured fields, never raw log text* (injection isolation); outputs confidence % + primary cause
5. **ReportWriter** — drafts postmortem; **ELSER semantic search surfaces similar past incidents** (seeded "Red Sea 2024" so the first demo run shows a real % match)
6. **Critic** — deterministic regex layer + LLM semantic layer, **fails closed**; injection detection disables the Approve button
7. **Human gate** — `/run` only ever returns a draft; write happens only via `POST /approve/{id}`; approved postmortem re-indexed semantically → **memory flywheel** ("every postmortem you approve makes the next investigation faster")

Differences vs our Sunday plan: single evidence source (Elastic logs) vs our multi-app evidence
(Sentry + Slack + GitHub); their citation rule was per-recommendation, ours is per-claim +
machine-verified; no Lemma instrumentation.

## Patterns to port to the Lemma hackathon build

**Architecture / reliability (feeds the 25% reliability score):**
- Staged specialist pipeline with visible per-stage results — maps 1:1 to Lemma trace spans
- Critic-always-last: deterministic checks + LLM check, fails closed
- Injection isolation: the reasoning stage never sees raw Slack text / log lines (attacker-controllable!) — only structured extracted fields. *Directly relevant: our Slack incident channel is untrusted input.*
- Draft → explicit approve → write. Nothing external happens without the gate.
- Every recommendation must cite a specific artifact (service/pattern/event_id) — matches our per-claim citation+verify design
- Memory flywheel (stretch goal Sunday): store finished postmortems, embed them, surface "similar past incident" in new reports — a strong originality beat

**Demo craft (feeds demo clarity 10% + trust):**
- Deterministic seeded fixtures; **seed one prior incident** so the very first run demonstrates semantic recall
- A second, different-domain scenario ("Load Auth Outage Demo") for a universality beat
- "Fixture vs live" honesty framing: the scenario stage is scripted, the agent's run is genuinely live — narrate them as such, never claim a static label is computed
- ACCURACY GUARDRAILS block: verify every scripted claim against the actual code before recording; never narrate an exact number the screen might not show
- Timed beat skeleton (works compressed to 2:00): platform in one breath → plain-language problem → live run (weight most time here) → depth beat → universality → CTA
- Devpost description ≈145 words + 3 social captions per project — reusable formula

**Ops discipline:**
- Phase plan with per-day *exit criteria* + risk register (adapt to hour-by-hour for a 6.5h build)
- Trial-account clock staggering so nothing expires before judging
- One-command telemetry init with env-var-driven fan-out and documented silent-fail traps
  (protocol/endpoint/header/temporality) — same care applies to Lemma SDK setup
- Submission README template: Deploy in 3 minutes / See it working now / Connect your own data / Limitations

## Cautions

- **Check Sunday's rules on pre-existing code.** Ideas, architecture, fixtures-style approach are fine;
  wholesale code reuse may not be (and it's Gemini/ADK/GCP/Python — our plan is TS/Vercel AI SDK/Claude,
  so we'd port patterns, not code anyway). The repo is MIT.
- ShipSafe scope was 13 days × 6 agents. VoyageBlack's 6-stage pipeline is roughly the right size for
  one focused 6.5-hour build *only if* all integrations and fixtures are prepped beforehand.
- `critic/base.py` referenced in README doesn't exist in this repo (empty package) — the Critic logic
  lives in the agent repos; don't assume shared code exists without checking.

## Sunday synthesis: VoyageBlack × Lemma

Pitch evolution: VoyageBlack proved "logs → postmortem in 90s" on one data source. The hackathon
build generalizes it to **the places incident evidence actually lives** (Sentry, Slack, GitHub),
adds **machine-verified per-claim citations**, publishes to the tools teams use (Notion, Linear,
Slack), and is itself **observable in Lemma** — the reliability platform judging the event —
with its failure modes mapped to Lemma's own taxonomy. Stretch: the ELSER-style memory flywheel.
