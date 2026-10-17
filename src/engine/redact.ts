import type { RedactionResult, RedactionSummary } from "../types.ts";

/**
 * Secret redaction for anything entering long-term memory.
 *
 * Auto-ingest means raw conversation text, shell output and diffs land in the
 * database; without this a leaked token would be stored (and later recalled
 * into a prompt) verbatim. Patterns are deliberately anchored and bounded to
 * stay linear-time (no nested quantifiers).
 */
const PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "openai_key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g },
  { kind: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { kind: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "aws_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g },
  { kind: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g },
  {
    kind: "private_key",
    pattern: /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]{0,4000}?-----END [A-Z ]{0,40}PRIVATE KEY-----/g,
  },
  {
    // Keeps the variable name so "why did auth fail" context survives: KEY=[REDACTED:env_secret]
    kind: "env_secret",
    pattern:
      /\b([A-Z0-9_]{0,40}(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]{0,40})\s*[:=]\s*["']?[^\s"']{6,}["']?/g,
  },
];

export function redactSecrets(text: string): RedactionResult {
  let output = text;
  const counts = new Map<string, number>();

  for (const { kind, pattern } of PATTERNS) {
    output = output.replace(pattern, (match: string, ...rest: unknown[]) => {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      const capturedKey = typeof rest[0] === "string" ? rest[0] : null;
      return capturedKey ? `${capturedKey}=[REDACTED:${kind}]` : `[REDACTED:${kind}]`;
    });
  }

  const redactions: RedactionSummary[] = [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  return {
    text: output,
    redacted: redactions.reduce((sum, r) => sum + r.count, 0),
    redactions,
  };
}
