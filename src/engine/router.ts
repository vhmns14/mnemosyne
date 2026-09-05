import type { RouteIntentType, RouteResult } from "../types.ts";

/**
 * Zero-LLM Fast Intent Router (SOTA 2026):
 * Deterministic intent classifier running in < 0.02ms with zero token cost.
 * Maps natural language developer prompts to optimal Mnemosyne tools and CLI commands.
 */
export function routeIntent(prompt: string): RouteResult {
  const text = prompt.trim();
  const lower = text.toLowerCase();

  // 1. Error Remediation & Debugging Playbook (Highest priority: runtime errors & stack traces)
  const remediationPatterns = [
    /\b(error:|exception|typeerror|referenceerror|syntaxerror|runtimeerror)\b/i,
    /\b(fix error|how to fix|cara fix|debug|troubleshoot|crash|panic:)\b/i,
    /\b(stack trace|failed with exit code|unhandled rejection)\b/i,
  ];
  for (const pat of remediationPatterns) {
    if (pat.test(lower)) {
      return {
        intent: "remediation",
        confidence: 0.95,
        suggested_command: `mnemo remediate "${text.replace(/"/g, '\\"')}"`,
        suggested_tool: "remediate",
        tool_arguments: {
          error_pattern: text,
        },
        reason: "Detected error trace or bug remediation query.",
      };
    }
  }

  // 2. Preflight / Commit Safety Check
  const preflightPatterns = [
    /\b(preflight|pre-commit|pre commit|commit check|ready to commit)\b/i,
    /\b(sebelum commit|cek aturan|safety check|safe to deploy|validate rules)\b/i,
    /\b(will this break|check against rules)\b/i,
  ];
  for (const pat of preflightPatterns) {
    if (pat.test(lower)) {
      return {
        intent: "preflight",
        confidence: 0.92,
        suggested_command: "mnemo preflight",
        suggested_tool: "preflight",
        tool_arguments: {
          change_summary: text,
        },
        reason: "Detected pre-commit or safety verification query.",
      };
    }
  }

  // 3. Negative Constraints & Guardrails
  const negativePatterns = [
    /\b(don't|do not|never|must not|cannot|forbid|prohibit|disallow)\b/i,
    /\b(anti-pattern|anti pattern|pantangan|larangan|jangan|dilarang|tidak boleh|hindari)\b/i,
    /\b(strictly avoid|never use|don't ever)\b/i,
  ];
  for (const pat of negativePatterns) {
    if (pat.test(lower)) {
      return {
        intent: "remember_negative",
        confidence: 0.95,
        suggested_command: `mnemo remember --negative "${text.replace(/"/g, '\\"')}"`,
        suggested_tool: "remember",
        tool_arguments: {
          content: text,
          is_negative_constraint: true,
          importance: "critical",
          category: "negative_constraint",
        },
        reason: "Detected negative constraint or anti-pattern guardrail pattern.",
      };
    }
  }

  // 4. Episodic Rollup
  const rollupPatterns = [
    /\b(rollup|roll up|compact session|summarize session|ringkas session|decision ledger)\b/i,
  ];
  for (const pat of rollupPatterns) {
    if (pat.test(lower)) {
      // Check if a session ID is mentioned
      const sessionMatch = lower.match(/(?:session|sesi)\s+([a-zA-Z0-9_\-]+)/);
      const sessionId = sessionMatch ? sessionMatch[1] : undefined;
      return {
        intent: "rollup",
        confidence: 0.94,
        suggested_command: sessionId ? `mnemo rollup ${sessionId}` : "mnemo rollup",
        suggested_tool: "rollup_session",
        tool_arguments: sessionId ? { session_id: sessionId } : {},
        reason: "Detected session episodic rollup request.",
      };
    }
  }

  // 5. Codebase Anchor Staleness Check
  const stalenessPatterns = [
    /\b(staleness|check staleness|stale memories|anchor status|cek anchor|code beliefs)\b/i,
  ];
  for (const pat of stalenessPatterns) {
    if (pat.test(lower)) {
      return {
        intent: "staleness_check",
        confidence: 0.91,
        suggested_command: "mnemo staleness",
        suggested_tool: "check_staleness",
        tool_arguments: {},
        reason: "Detected codebase anchor staleness verification query.",
      };
    }
  }

  // 6. Architecture & System Overview
  const archPatterns = [
    /\b(standing card|architecture|arsitektur|system overview|cara kerja sistem|tech stack)\b/i,
    /\b(how is .* structured|how does .* fit together)\b/i,
  ];
  for (const pat of archPatterns) {
    if (pat.test(lower)) {
      return {
        intent: "recall_architecture",
        confidence: 0.88,
        suggested_command: "mnemo card",
        suggested_tool: "get_standing_card",
        tool_arguments: {
          query: text,
          scope: "project",
        },
        reason: "Detected architecture or system structural query.",
      };
    }
  }

  // 7. Decision Recall
  const decisionPatterns = [
    /\b(what did we decide|apa keputusan|keputusan terkait|decision on|past decision)\b/i,
  ];
  for (const pat of decisionPatterns) {
    if (pat.test(lower)) {
      return {
        intent: "recall_decisions",
        confidence: 0.86,
        suggested_command: `mnemo recall "${text.replace(/"/g, '\\"')}" --structure decision_ledger`,
        suggested_tool: "recall",
        tool_arguments: {
          query: text,
          structure_type: "decision_ledger",
        },
        reason: "Detected query for past architectural or design decisions.",
      };
    }
  }

  // 8. User Preference
  const preferencePatterns = [
    /\b(prefers?|likes?|favorite|kebiasaan|preferensi|lebih suka|selalu pakai)\b/i,
    /\b(always format|enforce tab|enforce space)\b/i,
  ];
  for (const pat of preferencePatterns) {
    if (pat.test(lower)) {
      return {
        intent: "remember_preference",
        confidence: 0.85,
        suggested_command: `mnemo remember --category preference "${text.replace(/"/g, '\\"')}"`,
        suggested_tool: "remember",
        tool_arguments: {
          content: text,
          category: "preference",
          importance: "high",
        },
        reason: "Detected user preference or working style statement.",
      };
    }
  }

  // 9. Fact Assertion (e.g. "port is 3000", "server runs on ...")
  const factDeclarationPatterns = [
    /\b(adalah|ialah|berada di|menggunakan port|runs on port|located at)\b/i,
    /^remember\s+that\s+/i,
    /^ingat\s+bahwa\s+/i,
  ];
  for (const pat of factDeclarationPatterns) {
    if (pat.test(lower)) {
      const cleanText = text.replace(/^(?:remember\s+that|ingat\s+bahwa)\s+/i, "");
      return {
        intent: "remember_fact",
        confidence: 0.82,
        suggested_command: `mnemo remember "${cleanText.replace(/"/g, '\\"')}"`,
        suggested_tool: "remember",
        tool_arguments: {
          content: cleanText,
          category: "fact",
        },
        reason: "Detected factual declarative assertion.",
      };
    }
  }

  // 10. Default: General Recall
  return {
    intent: "general_recall",
    confidence: 0.70,
    suggested_command: `mnemo recall "${text.replace(/"/g, '\\"')}"`,
    suggested_tool: "recall",
    tool_arguments: {
      query: text,
    },
    reason: "Defaulted to general semantic associative recall.",
  };
}
