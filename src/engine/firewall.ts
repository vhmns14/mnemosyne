import type { Database } from "bun:sqlite";
import type { PreflightVerdict } from "../types.ts";
import { detectSemanticDrift } from "./drift.ts";

/**
 * Hardcoded P0 Laptop Safeguards (Workspace & Hardware Invariants)
 */
const HARD_RULES = [
  {
    rule_id: "RAM_SAFEGUARD_UNDANGAN_DIGITAL",
    pattern: /(next\s+build|opennextjs-cloudflare\s+build)/i,
    context_filter: /(undangan-digital)/i,
    violation_type: "hardware_limit" as const,
    reason: "Strict Rule: 'opennextjs-cloudflare build' / 'next build' consumes excessive RAM and will hang 16GB laptop. Deploy via Cloudflare Workers Builds (git push) instead.",
    recommendation: "Push your changes to GitHub and let Cloudflare Workers remote builds compile the project.",
  },
  {
    rule_id: "RAM_SAFEGUARD_BACKGROUND_BUILD",
    pattern: /(&\s*$|run_in_background|nohup\s+.*(build|opennext|wrangler|cargo|playwright))/i,
    violation_type: "hardware_limit" as const,
    reason: "Strict Rule: Never run heavy build/benchmark tasks in the background. Laptop has hung and forced hard power-off.",
    recommendation: "Run tasks synchronously in the foreground one at a time, and wait for completion.",
  },
  {
    rule_id: "HYGIENE_DATABASE_FILES_GIT",
    pattern: /git\s+(add|commit).*(\.db|\.db-wal|\.db-shm|mnemosyne\.db)/i,
    violation_type: "database_hygiene" as const,
    reason: "Strict Rule: SQLite database files (*.db, *.db-wal, *.db-shm) must NEVER enter git repositories.",
    recommendation: "Add database files to .gitignore and unstage them immediately using 'git reset HEAD <file>'.",
  },
  {
    rule_id: "RAM_SAFEGUARD_PARALLEL_EXECUTION",
    pattern: /(xargs\s+-P\s*[2-9]|parallel\s+-j\s*[2-9])/i,
    violation_type: "hardware_limit" as const,
    reason: "Strict Rule: Do not run parallel heavy processes on this 16GB RAM laptop.",
    recommendation: "Execute commands sequentially with concurrency limit of 1.",
  },
];

/**
 * Pre-Flight Agent Firewall
 * Intercepts and validates proposed shell commands or tool actions
 */
export async function evaluatePreflight(
  db: Database,
  commandOrAction: string,
  options: {
    contextPath?: string;
    strictMode?: boolean;
    driftThreshold?: number;
  } = {}
): Promise<PreflightVerdict> {
  const text = (commandOrAction || "").trim();
  if (!text) {
    return { allowed: true, risk_level: "safe" };
  }

  const context = (options.contextPath || "").toLowerCase();
  const fullTextWithContext = `${context} ${text}`;

  // 1. Evaluate Hard Rules (Instant P0 OS/Hardware Guards)
  for (const rule of HARD_RULES) {
    if (rule.pattern.test(text)) {
      if (!rule.context_filter || rule.context_filter.test(fullTextWithContext)) {
        return {
          allowed: false,
          risk_level: "blocked",
          violation_type: rule.violation_type,
          blocked_reason: rule.reason,
          recommendation: rule.recommendation,
          matched_rule: rule.rule_id,
        };
      }
    }
  }

  // 2. Evaluate Dynamic Negative Constraints from SQLite
  try {
    const negativeRows = db.query(`
      SELECT id, content FROM memories 
      WHERE is_negative_constraint = 1 AND is_active = 1
    `).all() as Array<{ id: string; content: string }>;

    for (const neg of negativeRows) {
      const cleanNeg = neg.content.toLowerCase();
      // Match negative rule phrases
      if (
        cleanNeg.includes("jangan") ||
        cleanNeg.includes("dilarang") ||
        cleanNeg.includes("never") ||
        cleanNeg.includes("tidak boleh") ||
        cleanNeg.includes("do not")
      ) {
        const words = cleanNeg
          .replace(/(jangan|dilarang|never|tidak boleh|do not|harus|strict rule:|menjalankan|pada|yang|untuk|dalam|dengan|dan|atau|di|ke|dari)/gi, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 2);

        if (words.length > 0) {
          const matchCount = words.filter((w) => text.toLowerCase().includes(w)).length;
          const threshold = Math.min(2, words.length);
          if (matchCount >= threshold) {
            return {
              allowed: false,
              risk_level: "blocked",
              violation_type: "negative_constraint",
              blocked_reason: `Action violates registered negative constraint: "${neg.content}"`,
              matched_rule: "DYNAMIC_NEGATIVE_CONSTRAINT",
              recommendation: "Review operational rules in AGENTS.md or memory dashboard before proceeding.",
            };
          }
        }
      }
    }

    // 3. Evaluate Semantic Drift against vector space
    const drift = await detectSemanticDrift(db, text, options.driftThreshold || 0.40);
    if (drift.is_drift && drift.divergence_score > 0.45) {
      return {
        allowed: false,
        risk_level: "warning",
        violation_type: "negative_constraint",
        blocked_reason: drift.explanation || "Action diverges significantly from established architectural constraints.",
        matched_rule: drift.conflicting_memory_id,
        divergence_score: drift.divergence_score,
        recommendation: "Consider re-evaluating the proposed action to align with project conventions.",
      };
    }
  } catch (err: any) {
    console.warn("Preflight database check warning:", err.message);
  }

  return {
    allowed: true,
    risk_level: "safe",
  };
}
