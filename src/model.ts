import { groq } from "@ai-sdk/groq";

/**
 * Single shared model instance for every `generateObject` call in the
 * pipeline (RootCauseAnalyzer, Critic's semantic layer, citation
 * support-checks). Centralized here so swapping providers/models is a
 * one-line change instead of hunting through three files.
 *
 * Model choice verified against this account's real available models
 * (`GET https://api.groq.com/openai/v1/models`) rather than guessed — an
 * initial guess (llama-3.3-70b-versatile) wasn't even in the list.
 * openai/gpt-oss-120b: largest general-purpose model available, 131k
 * context, built with strong structured-output/function-calling support,
 * which is exactly what `generateObject`'s Zod-schema constraint needs.
 *
 * Override with GROQ_MODEL if a different Groq-hosted model is preferred.
 */
export const model = groq(process.env.GROQ_MODEL ?? "openai/gpt-oss-120b");
