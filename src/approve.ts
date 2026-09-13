import { getDraft, saveDraft } from "./store.js";
import { publishToNotion } from "./publish/notion.js";
import { fileLinearTickets } from "./publish/linear.js";
import { postSummaryToSlack } from "./publish/slack-post.js";
import { openHardeningPR } from "./publish/github-pr.js";
import type { OrchestrationResult } from "./schemas.js";
import { newLemmaTelemetry } from "./lemma.js";

interface Attemptable {
  ok: boolean;
  url?: string;
  error?: string;
}

export interface ApproveResult {
  incidentId: string;
  published: boolean;
  needsEscalation: boolean;
  notion: Attemptable & { attempts: number };
  linear: (Attemptable & { attempts: number })[];
  slack: Attemptable & { attempts: number };
  /** Undefined when no hardening proposal was drafted (see notes/05) — not a failure, just nothing to open. */
  hardeningPR?: Attemptable & { attempts: number };
}

// "Bounded retries (max 2)" per the reliability brief = 1 initial attempt + 2 retries.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;

async function withRetry<T extends Attemptable>(
  label: string,
  fn: () => Promise<T>,
): Promise<T & { attempts: number }> {
  let last: T | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      last = await fn();
    } catch (err) {
      // A thrown error (e.g. missing credentials — every publisher throws
      // for that, matching the evidence fetchers' convention) must degrade
      // the same as a returned {ok:false}, not abort the whole approve flow.
      // Caught via reasoning through this exact scenario before the first
      // live run, not discovered live — see notes/05.
      last = { ok: false, error: err instanceof Error ? err.message : String(err) } as T;
    }
    if (last.ok) return { ...last, attempts: attempt };
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[approve] ${label} failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${last.error}`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  // last is guaranteed non-null: the loop always runs at least once.
  return { ...last!, attempts: MAX_ATTEMPTS };
}

/**
 * Approve-by-reference and publish. Callers (e.g. a Slack "Approve" button)
 * send ONLY the incidentId — the draft is loaded from the server-side store,
 * never accepted from the caller. This is the direct fix for the bug found
 * in VoyageBlack (notes/07): its POST /approve/{id} accepted the full draft
 * in the request body with no server-side store and no re-check, so a
 * fabricated draft could be written directly.
 *
 * Re-verification at approve time: even though our store isn't
 * client-writable (so the draft literally can't have been tampered with
 * the way VoyageBlack's could), we still explicitly re-check the stored
 * verdict before publishing rather than assuming "an approve call exists"
 * implies "this is safe to publish." An injection-flagged or unapproved
 * draft is refused here regardless of how approveAndPublish got invoked.
 *
 * Resilience: each publish target gets up to 3 attempts (1 + 2 retries)
 * with backoff. One target failing all its attempts does NOT abort the
 * others — mirrors the evidence-collection "per-source graceful
 * degradation" principle, applied to publishing. The aggregate result
 * reports needsEscalation:true if anything never succeeded, so a human
 * can follow up on exactly what's missing instead of a silent partial write.
 */
export async function approveAndPublish(incidentId: string): Promise<ApproveResult> {
  const stored = getDraft(incidentId);
  if (!stored) {
    throw new Error(`approveAndPublish: no draft found for incident "${incidentId}" — nothing to approve`);
  }

  if (!stored.verdict.approved || stored.verdict.injectionDetected) {
    throw new Error(
      `approveAndPublish: incident "${incidentId}" is not approved for publishing ` +
        `(approved=${stored.verdict.approved}, injectionDetected=${stored.verdict.injectionDetected}) — refusing`,
    );
  }

  const telemetry = newLemmaTelemetry("postmortem-agent-publish");

  try {
    const notion = await withRetry("Notion", () => publishToNotion(stored.draft, stored.verificationStats));
    const notionUrl = notion.ok ? notion.url! : "(Notion publish failed — see postmortem draft)";

    const linear = await Promise.all(
      stored.draft.actionItems.map((item) =>
        withRetry(`Linear: ${item.slice(0, 40)}`, async () => {
          const [result] = await fileLinearTickets([item], incidentId);
          return result!;
        }),
      ),
    );

    const slack = await withRetry("Slack", () =>
      postSummaryToSlack(incidentId, notionUrl, stored.verificationStats),
    );

    // Only attempt the hardening PR if a proposal was actually drafted —
    // proposeHardening() is best-effort (see orchestrator.ts) and may be absent.
    const hardeningPR = stored.hardeningProposal
      ? await withRetry("GitHub hardening PR", () =>
          openHardeningPR(stored.hardeningProposal!, incidentId),
        )
      : undefined;

    const needsEscalation =
      !notion.ok || linear.some((r) => !r.ok) || !slack.ok || (hardeningPR ? !hardeningPR.ok : false);

    const updated: OrchestrationResult = {
      ...stored,
      draft: { ...stored.draft, status: needsEscalation ? "approved" : "written" },
    };
    saveDraft(incidentId, updated);

    await telemetry.flush();

    return {
      incidentId,
      published: !needsEscalation,
      needsEscalation,
      notion,
      linear,
      slack,
      ...(hardeningPR ? { hardeningPR } : {}),
    };
  } catch (err) {
    await telemetry.fail(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    await telemetry.shutdown();
  }
}
