/**
 * Static, deterministic prompt-injection scanning — no LLM call.
 *
 * Ported from VoyageBlack's Critic (see notes/07-voyageblack-critic-analysis.md),
 * with one change: their scan ran once, on the assembled draft, after evidence
 * had already passed through reasoning stages. Ours runs at ingestion — on every
 * raw string pulled from Sentry/Slack/GitHub, before it can enter any LLM
 * context at all. A quarantined string is kept for display (so a human can see
 * what was blocked) but is never passed to a reasoning stage.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|prior|all)\s+instructions/i,
  /disregard\s+(your|all|any)/i,
  /you\s+are\s+now\s+a/i,
  /forget\s+(everything|your|all)/i,
  /new\s+(system\s+)?prompt/i,
  /\bact\s+as\b/i,
  /SYSTEM\s*:/i,
  /<!--.*inject/is,
  /\{\{.*\}\}/s,
  /<\s*script\b/i,
  /jailbreak/i,
];

export interface ScanResult {
  detected: boolean;
  matchedPatterns: string[];
  snippet: string | null;
}

/** Scan one raw string. Pure function, no side effects, no network. */
export function scanForInjection(text: string): ScanResult {
  const matchedPatterns: string[] = [];
  let snippet: string | null = null;

  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      matchedPatterns.push(pattern.source);
      if (snippet === null) {
        const start = Math.max(0, match.index - 20);
        const end = Math.min(text.length, match.index + match[0].length + 20);
        snippet = text.slice(start, end).trim();
      }
    }
  }

  return { detected: matchedPatterns.length > 0, matchedPatterns, snippet };
}

/**
 * Sanitize one piece of raw evidence text for use in a reasoning stage.
 * Quarantined text is replaced with a placeholder — the original is preserved
 * separately (Evidence.raw) so it can still be shown to a human reviewer.
 */
export function sanitize(text: string): { sanitized: string; quarantined: boolean; scan: ScanResult } {
  const scan = scanForInjection(text);
  if (!scan.detected) {
    return { sanitized: text, quarantined: false, scan };
  }
  return {
    sanitized: "[quarantined: suspected prompt injection — see raw evidence]",
    quarantined: true,
    scan,
  };
}
