# VoyageBlack Critic — Implementation Analysis

> Analyzed 2026-09-10 from github.com/shipsafe-ai/shipsafe-voyageblack
> Files: `agent/critic.py` (217 ln), `agent/models.py`, `agent/orchestrator.py`,
> `agent/specialists/root_cause_analyzer.py`, `main.py` (/approve), `tests/test_critic.py` (228 ln)

## How it works

### Layer 1 — static regex scan (deterministic, no LLM, runs first)
- ~11 compiled patterns: `ignore previous instructions`, `disregard your/all`, `you are now a`,
  `forget everything`, `new (system) prompt`, `act as`, `SYSTEM:`, `<!--.*inject`, `{{...}}`
  (template injection), `<script`, `jailbreak`.
- Scans: draft `title` + `recommendations`, `root_cause.{primary_cause,contributing_factors,evidence}`,
  and **every timeline entry message** (commented as "primary injection surface").
- Extracts ±20-char context snippets for `blocked_content` (UI display).
- **Any hit short-circuits**: verdict = not approved, `risk_level=critical`, "Blocked without LLM
  review" — the LLM is never called (tests assert `Runner.assert_not_called()`). Fast, free, testable.

### Layer 2 — LLM semantic review (only on clean static scan)
- Prompt = full draft JSON + static scan results. Instruction asks for 4 checks:
  paraphrased injection, hallucination vs structured input, **external-action risk**
  ("recommendations to write/deploy/delete/alert REQUIRE human approval"), confidence audit.
- Returns typed `CriticVerdict` JSON: approved, injection_detected, injection_fields,
  requires_human_review, risk_level (none→critical), reasoning, blocked_content,
  confidence_multiplier (0.5–1.5).

### Fail-closed paths
- LLM call throws → `_safe_reject`: approved=False, review-required, risk=high.
- Unparseable response → same rejection.
- **Invariants enforced in code after the LLM**, never trusted from the model:
  ```python
  if verdict.injection_detected: verdict.approved = False
  verdict.requires_human_review = True   # ALWAYS — postmortem writes are external actions
  ```

### The gate around it
- Orchestrator: Critic is ALWAYS stage 6 (last); `ReportWriter.write()` is **never** called in `/run`.
- `POST /approve/{incident_id}` is the only write path; validates path/body incident_id match.
- Pipeline runs draft-only; human sees verdict + blocked snippets; approve button disabled on injection.

### Injection isolation upstream (defense-in-depth partner)
`RootCauseAnalyzer` receives **only structured fields** (service names, error counts, cascade
depths, event IDs) — "no raw log messages concatenated." Evidence items must cite specific
`event_id`s. So the reasoning stage never sees attacker-controllable text at all; the Critic
is the second line, not the only line.

### Test suite shape (worth copying)
Static detection per pattern family · clean-input negative cases · **short-circuit asserts the
LLM was NOT called** · fail-closed on LLM error · fail-closed on unparseable JSON · clean draft
passes through with requires_human_review still true.

## ⚠ Weaknesses found (lessons for our build)

1. **Fail-open default in the verdict model.** `CriticVerdict.approved: bool = True` — and every
   field has a default. The lenient parser tries `re.findall(r"\{[\s\S]*?\}")` fragments, so a
   near-JSON LLM reply containing any small `{...}` can validate into an **all-defaults verdict:
   approved=True, injection_detected=False, risk=none**. The forced `requires_human_review=True`
   keeps the human gate, but the "approved" badge lies.
   → **Lesson: security verdict schemas must have fail-closed defaults (approved=False) and
   required fields.**
2. **The approve endpoint trusts the client's draft.** `POST /approve/{id}` accepts the full
   `PostmortemDraft` in the request body — nothing verifies this draft is the one the pipeline
   produced and the Critic reviewed (no server-side draft store, no signature, no critic re-run).
   A fabricated draft can be written directly.
   → **Lesson: store drafts server-side; approve by reference (id only); optionally re-run the
   verifier at approve time.**
3. **The Critic itself ingests the attacker text.** Layer 2's prompt embeds the whole draft JSON,
   including raw timeline messages — so a paraphrased injection that beats the regexes gets a shot
   at the Critic LLM too. (Unavoidable for its job, but means Critic output must be treated as
   untrusted — which the code-level invariants partially do.)
4. **Citations are requested, never verified.** The prompt demands evidence cite `event_id`s, but
   nothing mechanically checks a cited EVT-004 exists in the timeline.
   → Our per-claim mechanical citation verifier goes strictly beyond this — keep it.
5. `confidence_multiplier` is defined and documented but never applied anywhere.
6. Static patterns are trivially bypassable by paraphrase (expected — that's why layer 2 exists),
   and `\{\{.*\}\}` with DOTALL could false-positive on legit braces in log text.

## Port plan for Sunday (TypeScript / Vercel AI SDK)

- `CriticVerdict` as a Zod schema with **approved: default(false)**, required fields; use the AI
  SDK's structured output (generateObject) instead of hand-rolled JSON fence stripping.
- **Run the static scan on raw evidence at ingestion time** (Slack messages, commit messages,
  Sentry titles) *before* anything enters an LLM context — earlier than VoyageBlack, which only
  scans the assembled draft.
- Keep structured-fields-only isolation for the root-cause/reasoning stage.
- Mechanical citation check (code, not LLM): every claim's citation must resolve to a real
  artifact ID in the evidence store; then an LLM support-check per claim; unsupported → cut.
- Server-side draft store keyed by incident id; Slack approve button sends the id only;
  verdict invariants enforced in code; approve disabled on injection (their UI pattern).
- Copy the test suite shape (esp. the short-circuit and both fail-closed tests).
- Every one of these maps to a Lemma taxonomy row for the reliability brief:
  static scan + isolation → *instruction violation*; fail-closed parsing → *hallucination*;
  approve-by-reference → *out-of-scope work*; forced review → *communication*.
