import { z } from "zod";

// ---------------------------------------------------------------------------
// Evidence — one typed item pulled from one external source, always carrying
// a stable artifactId so report claims can cite back to it mechanically.
// ---------------------------------------------------------------------------

export const EvidenceSourceSchema = z.enum(["sentry", "slack", "github", "lemma"]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const EvidenceSchema = z.object({
  artifactId: z.string().min(1), // e.g. "SLK-107", "GH-PR-482", "SEN-EVT-501"
  source: EvidenceSourceSchema,
  timestamp: z.string().datetime(),
  raw: z.string(), // original, UNSANITIZED text — never fed to an LLM directly
  sanitized: z.string(), // post-sanitize.ts text — safe to pass to reasoning stages
  quarantined: z.boolean().default(false), // true if sanitize.ts found an injection pattern
  metadata: z.record(z.string()).default({}),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const TimelineEntrySchema = z.object({
  artifactId: z.string().min(1),
  timestamp: z.string().datetime(),
  source: EvidenceSourceSchema,
  summary: z.string().min(1), // short, structured description — not raw evidence text
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

// ---------------------------------------------------------------------------
// Root cause — produced by RootCauseAnalyzer, which per the playbook only ever
// receives structured fields (ids, counts, timestamps), never raw evidence text.
// ---------------------------------------------------------------------------

export const RootCauseSchema = z.object({
  primaryCause: z.string().min(1),
  contributingFactors: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  citedArtifactIds: z.array(z.string()).min(1), // must cite at least one real artifact
});
export type RootCause = z.infer<typeof RootCauseSchema>;

/**
 * LLM-facing twin, all fields required, no `.default()`.
 *
 * OpenAI/Groq structured-output "strict" mode requires every property to
 * appear in the JSON schema's `required` array — a `.default()` field gets
 * excluded from `required` when converted to JSON schema, which strict mode
 * rejects outright (confirmed live against Groq's openai/gpt-oss-120b;
 * Anthropic's tool-based structured output had no such constraint). Use
 * this variant as the `schema` argument to `generateObject`; the inferred
 * output type is structurally identical to RootCause since a `.default()`
 * field's TS output type is already non-optional.
 */
export const RootCauseLLMSchema = z.object({
  primaryCause: z.string().min(1),
  contributingFactors: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  citedArtifactIds: z.array(z.string()).min(1),
});

// ---------------------------------------------------------------------------
// A single cited claim inside the draft — the unit the CitationVerifier checks.
// ---------------------------------------------------------------------------

export const ClaimSchema = z.object({
  text: z.string().min(1),
  citedArtifactId: z.string().min(1),
});
export type Claim = z.infer<typeof ClaimSchema>;

// ---------------------------------------------------------------------------
// Postmortem draft
// ---------------------------------------------------------------------------

export const PostmortemDraftSchema = z.object({
  incidentId: z.string().min(1),
  title: z.string().default(""),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("HIGH"),
  timeline: z.array(TimelineEntrySchema).default([]),
  rootCause: RootCauseSchema.optional(),
  claims: z.array(ClaimSchema).default([]), // every sentence worth citing goes here
  actionItems: z.array(z.string()).default([]),
  metrics: z
    .object({
      machineSignalLagMinutes: z.number().optional(),
      humanDetectionLagMinutes: z.number().optional(),
      timeToMitigateMinutes: z.number().optional(),
      totalDurationMinutes: z.number().optional(),
    })
    .default({}),
  status: z.enum(["draft", "approved", "written"]).default("draft"),
});
export type PostmortemDraft = z.infer<typeof PostmortemDraftSchema>;

// ---------------------------------------------------------------------------
// Citation verification result — one entry per claim, from verify/citations.ts
// ---------------------------------------------------------------------------

export const CitationCheckSchema = z.object({
  claim: ClaimSchema,
  artifactResolved: z.boolean(), // mechanical: does citedArtifactId exist in the evidence store?
  supported: z.boolean().default(false), // LLM support-check: does the artifact actually back the claim?
  reason: z.string().default(""),
});
export type CitationCheck = z.infer<typeof CitationCheckSchema>;

// ---------------------------------------------------------------------------
// Critic verdict
//
// ⚠ SECURITY-CRITICAL DEFAULTS — do not change without re-reading notes/07.
// VoyageBlack's Pydantic CriticVerdict defaulted `approved: bool = True`, and
// its lenient regex JSON parser could match a stray `{...}` fragment inside a
// noisy LLM response, silently producing an all-defaults verdict that read as
// APPROVED. We default to the fail-closed state instead: an empty or
// malformed model response must never look like a clean bill of health.
// ---------------------------------------------------------------------------

export const RiskLevelSchema = z.enum(["none", "low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const CriticVerdictSchema = z.object({
  approved: z.boolean().default(false), // fail-closed default — see warning above
  injectionDetected: z.boolean().default(true), // fail-closed default
  injectionFields: z.array(z.string()).default([]),
  requiresHumanReview: z.boolean().default(true), // always true in practice — enforced in code, not just here
  riskLevel: RiskLevelSchema.default("critical"), // fail-closed default
  reasoning: z.string().default("no reasoning provided"),
  blockedContent: z.array(z.string()).default([]),
});
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

/**
 * LLM-facing twin, all fields required, no `.default()`. Same rationale as
 * RootCauseLLMSchema above — use as the `schema` argument to
 * `generateObject`; keep CriticVerdictSchema (with its security-critical
 * fail-closed defaults) for the `.parse()` calls in critic.ts that build a
 * verdict from a partial object on the fail-closed paths.
 */
export const CriticVerdictLLMSchema = z.object({
  approved: z.boolean(),
  injectionDetected: z.boolean(),
  injectionFields: z.array(z.string()),
  requiresHumanReview: z.boolean(),
  riskLevel: RiskLevelSchema,
  reasoning: z.string(),
  blockedContent: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Hardening proposal — "what would have caught this earlier?"
//
// A concrete, runnable regression test proposed by pipeline/hardening.ts.
// Deliberately NOT nested inside PostmortemDraft: the draft is the
// narrative document (published to Notion); this is a separate code-change
// proposal consumed only by publish/github-pr.ts. All fields required — no
// `.default()` needed here, so no LLM-facing twin is required (unlike
// RootCauseSchema / CriticVerdictSchema — see the Groq strict-mode note
// above).
// ---------------------------------------------------------------------------

export const HardeningProposalSchema = z.object({
  description: z.string().min(1), // what this test does and why it would have caught the incident
  filePath: z.string().min(1), // e.g. "tests/test_policy_client_fail_closed.py"
  fileContent: z.string().min(1), // real, runnable test code — not a description of one
  prTitle: z.string().min(1),
});
export type HardeningProposal = z.infer<typeof HardeningProposalSchema>;

// ---------------------------------------------------------------------------
// Verification stats — the self-referential trust footer. Computed once in
// orchestrator.ts from data that already exists (citationChecks + evidence),
// not a new claim the agent makes about itself — a tally of checks already
// performed.
// ---------------------------------------------------------------------------

export const VerificationStatsSchema = z.object({
  totalClaimsChecked: z.number().int().min(0),
  claimsVerified: z.number().int().min(0),
  claimsCut: z.number().int().min(0),
  evidenceQuarantined: z.number().int().min(0),
});
export type VerificationStats = z.infer<typeof VerificationStatsSchema>;

// ---------------------------------------------------------------------------
// Orchestration result
// ---------------------------------------------------------------------------

export const OrchestrationResultSchema = z.object({
  draft: PostmortemDraftSchema,
  citationChecks: z.array(CitationCheckSchema).default([]),
  verdict: CriticVerdictSchema,
  approved: z.boolean(),
  requiresHumanReview: z.boolean(),
  hardeningProposal: HardeningProposalSchema.optional(),
  verificationStats: VerificationStatsSchema,
});
export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;
