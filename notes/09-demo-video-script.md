# Demo video script — 2:00 max, target 1:50

Recording plan for the ≤2-minute submission video. Everything referenced here is real: the
artifacts linked below were produced by an actual `npm run postmortem -- INC-142-CLEAN && npm run
approve -- INC-142-CLEAN` run on 2026-09-14, not staged.

## Before you hit record

1. **Do NOT re-run the pipeline live on camera.** `INC-142` (the fixture with the planted
   paraphrased injection) reliably ends blocked; `INC-142-CLEAN` reliably ends approved and
   published — but an LLM call is still non-deterministic in wording and takes real seconds. Use
   the pre-generated real output below and the terminal scrollback/log files instead of gambling a
   take on a live call.
2. **Open every tab in this order before recording** (alt-tab during the take, don't search live):
   1. Terminal, font large, at the repo root
   2. Notion page: https://app.notion.com/p/Incident-INC-142-CLEAN-A-mismatched-CMS-slug-introduced-by-PR-482-caused-the-polic-3dae5ef6beba8105a8a5e480f0bb936d
   3. Linear ticket list (any one, e.g. https://linear.app/prats2311/issue/RAN-17/address-lemma-flagged-the-hallucination-issue-lmaiss233-but-no ) — or the team's board view showing all 6 (RAN-17 through RAN-22)
   4. Slack message: https://slack.com/archives/C0C1B8FCELB/p1789334427695809
   5. GitHub hardening PR diff: https://github.com/prats-2311/brightcart-support-agent-/pull/5
   6. Your Lemma dashboard tab (already open per your browser — the project this agent traces to)
   7. GitHub repo root: https://github.com/prats-2311/postmortem-agent
3. In the terminal, have `/tmp/pm-out.log` and `/tmp/approve-out.log` ready to `cat`/scroll if you
   don't want to wait on a live LLM call — both are real output from the actual run.
4. Screen record at 1080p (QuickTime → New Screen Recording, mic on). Narrate live or dub after.

---

## Timestamped script

### 0:00–0:12 — The problem (12s)
**Screen:** Terminal at repo root, or the README's title/problem section scrolled into view.
**Say:**
> "When an incident happens, the evidence is scattered across Sentry, Slack, and GitHub — and
> writing the postmortem by hand takes hours someone doesn't have. This is an AI postmortem
> agent that does it for you, and mechanically verifies every claim before it publishes anything."

### 0:12–0:32 — Evidence gathering + Lemma as a source (20s)
**Screen:** Lemma dashboard → **Traces** → open trace `a8ef09d9-45a3-5af0-ac9b-5ca3687c6aec`
(support-agent, 11 Sept 2026). Real, live, already on screen — not staged. Point at, in order:
1. The conversation: user says "my headphones case cracked, box was opened, refund pls";
   agent replies "Absolutely! Our 30-day full refund policy covers this, no questions asked.
   Refund initiated."
2. The `fetch_policy` span — 205ms, shown with a warning/error indicator.
3. The banner at the top of the trace: **"Analysis found no issues in this trace."**
**Say:**
> "This is a real trace from our own support agent. It's asked about a refund, the policy
> lookup call comes back flagged — and the agent still confidently answers with a specific
> refund policy anyway. Lemma's own analysis on this exact trace says no issues found. That's
> the failure mode this whole project exists to catch: an AI system sounding confident isn't the
> same as being right — which is why every claim we publish gets mechanically re-verified
> against the evidence, not just asserted because a model said it."
**Why this works:** fully real, fully truthful, and it's the single most concrete "wow" moment
in the video — a live detector visibly missing the exact thing it's built to catch, shown on
camera, not claimed in prose. It also sets up the fail-closed critic segment at 0:50 perfectly:
"detectors miss things → so we verify mechanically" is the throughline for the whole pitch.

### 0:32–0:50 — Run the pipeline, live terminal (18s)
**Screen:** Terminal — either run `npm run postmortem -- INC-142-CLEAN` live and let it play, or
`cat /tmp/pm-out.log` and scroll through the real saved output at a readable pace.
**Say:**
> "It sanitizes every piece of evidence for prompt injection before any of it reaches a model,
> reconstructs the timeline, and reasons about root cause — only over structured fields, never
> raw evidence text."

### 0:50–1:05 — The fail-closed catch (15s) — the strongest differentiator, don't cut this
**Screen:** Terminal — `cat /tmp/pm-out.log` scrolled to the `INC-142` (not -CLEAN) run's verdict
block (`"injectionDetected": true`, `"blockedContent": [...]`), OR just describe it over the
Notion/Slack tabs if you'd rather not re-scroll.
**Say:**
> "One of our test incidents has a prompt injection hidden in a log line, worded to slip past a
> simple keyword filter. It does slip past the first layer — but the LLM Critic reviewing the
> final draft catches it and refuses to publish. That's the fail-closed design working, not a
> hypothetical."

### 1:05–1:15 — Human approval gate (10s)
**Screen:** Terminal — `cat /tmp/approve-out.log` (or run `npm run approve -- INC-142-CLEAN` live
if you already ran postmortem live above).
**Say:**
> "On a clean incident, a human approves by reference — just an incident ID, never a
> client-supplied draft — and only then does it actually publish."

### 1:15–1:40 — Show the real publishes (25s)
**Screen:** Quick cuts, ~6s each: Notion page (scroll to citations/verification footer) → Linear
tickets (show 2–3 of the 5) → Slack message → GitHub PR diff (the regression test file).
**Say:**
> "A real Notion postmortem with every claim cited. Real Linear tickets, one per action item.
> A Slack summary back to the incident channel. And a real pull request with a regression test
> targeting the exact failure — not just a bullet-point recommendation."

### 1:40–1:50 — Close (10s)
**Screen:** GitHub repo root (README visible) or Lemma dashboard tab one more time.
**Say:**
> "Every piece here — Sentry, Slack, GitHub, Lemma, Notion, Linear — is a live, real
> integration, tested against real accounts, with seventy-nine tests and a scored eval harness.
> Repo's linked below. Thanks."

---

## If you're short on time and must cut something

Cut 1:15–1:40 down to 2 artifacts instead of 4 (Notion + PR are the most visually convincing) —
do NOT cut 0:50–1:05 (the injection-block segment) or the Lemma trace segment (0:12–0:32); those
are the two moments that differentiate this from "an LLM wrapper with a nice README."
