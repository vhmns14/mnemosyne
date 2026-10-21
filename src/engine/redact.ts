import type { RedactionResult, RedactionSummary } from "../types.ts";

/**
 * Secret redaction for anything entering long-term memory.
 *
 * Auto-ingest means raw conversation text, shell output and diffs land in the
 * database; without this a leaked token would be stored (and later recalled
 * into a prompt) verbatim. Patterns are deliberately anchored and bounded to
 * stay linear-time (no nested quantifiers).
 */
type Replacer = (match: string, groups: string[]) => string | null;

const PATTERNS: Array<{ kind: string; pattern: RegExp; replace?: Replacer }> = [
  { kind: "openai_key", pattern: /\bsk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{16,}/g },
  { kind: "stripe_key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "github_token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: "gitlab_token", pattern: /\bglpat-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "huggingface_token", pattern: /\bhf_[A-Za-z0-9]{20,}\b/g },
  { kind: "npm_token", pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  { kind: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "telegram_bot_token", pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/g },
  { kind: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "aws_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g },
  { kind: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g },
  {
    kind: "private_key",
    pattern: /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]{0,4000}?-----END [A-Z ]{0,40}PRIVATE KEY-----/g,
  },
  {
    // https://user:pass@host -> keeps scheme/user/host, drops the password.
    kind: "url_credential",
    pattern: /\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]{1,100}):([^\s@/]{1,200})@/gi,
    replace: (_m, g) => `${g[0]}:[REDACTED:url_credential]@`,
  },
  {
    // Keeps the variable name so "why did auth fail" context survives: KEY=[REDACTED:env_secret]
    kind: "env_secret",
    pattern:
      /\b([A-Z0-9_]{0,40}(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]{0,40})\s*[:=]\s*["']?[^\s"']{6,}["']?/g,
  },
  {
    // Natural language, English + Indonesian: "password wifi kantor: Rahasia#2026",
    // "my password is hunter22", "pw gue = abc123!", "api key-nya: ...".
    // Only redacts values that look like a credential (has a digit/symbol, or is long),
    // so "the token is expired" survives.
    kind: "credential",
    pattern:
      /\b(pass(?:word|wd|code|phrase)?|pwd|pw|sandi|kata\s?sandi|api[\s_-]?key|secret|token)((?:-?nya)?(?:\s+(?:gue|gw|aku|saya|ku|ane|my|the|wifi|kantor|rumah|email|bank|atm|akun|login|server|db|database)){0,3}\s*(?:[:=]|\bis\b|\badalah\b|\bitu\b|\byaitu\b|\bnya\b)\s*["'`]?)([^\s"'`]{4,200})/gi,
    replace: (_m, g) => (/[\d\W_]/.test(g[2]) || g[2].length >= 12 ? `${g[0]}${g[1]}[REDACTED:credential]` : null),
  },
  {
    // PINs / OTPs / card security codes: "pin ATM gue 123456", "OTP: 884512", "cvv 123".
    kind: "pin",
    pattern: /\b(pin|otp|kode\s?otp|cvv|cvc)((?:-?nya)?(?:\s+(?:gue|gw|aku|saya|ku|my|the|atm|bank|kartu|card|login)){0,3}\s*(?:[:=]|\bis\b|\badalah\b)?\s*)(\d{3,8})\b/gi,
    replace: (_m, g) => `${g[0]}${g[1]}[REDACTED:pin]`,
  },
  {
    // Payment card numbers (13-19 digits, Luhn-valid, issuer prefix 3-6).
    kind: "card_number",
    pattern: /\b[3-6]\d(?:[ -]?\d){11,17}\b/g,
    replace: (m) => (luhn(m.replace(/\D/g, "")) ? "[REDACTED:card_number]" : null),
  },
];

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function redactSecrets(text: string): RedactionResult {
  let output = text;
  const counts = new Map<string, number>();

  for (const { kind, pattern, replace } of PATTERNS) {
    output = output.replace(pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.filter((r): r is string => typeof r === "string" || r === undefined).map((r) => (r === undefined ? "" : r));
      let replacement: string | null;
      if (replace) {
        replacement = replace(match, groups);
      } else {
        const capturedKey = typeof rest[0] === "string" ? rest[0] : null;
        replacement = capturedKey ? `${capturedKey}=[REDACTED:${kind}]` : `[REDACTED:${kind}]`;
      }
      if (replacement === null) return match;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      return replacement;
    });
  }

  const redactions: RedactionSummary[] = [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  return {
    text: output,
    redacted: redactions.reduce((sum, r) => sum + r.count, 0),
    redactions,
  };
}
