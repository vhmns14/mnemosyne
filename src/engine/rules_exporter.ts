import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MemoryRecord } from "../types.ts";

export type RuleFormat = "agents.md" | "cursorrules" | "claude.md" | "system_prompt";

export interface RuleExportResult {
  content: string;
  ruleCount: number;
  negativeCount: number;
}

export interface RuleSyncResult extends RuleExportResult {
  filePath: string;
  updatedExisting: boolean;
  createdNew: boolean;
}

export const MARKER_START = "<!-- MNEMOSYNE_RULES_START -->";
export const MARKER_END = "<!-- MNEMOSYNE_RULES_END -->";

/**
 * Queries active rules and negative constraints from Mnemosyne.
 */
export function getActiveRules(db: Database, scope: string = "all"): {
  negativeConstraints: MemoryRecord[];
  standardRules: MemoryRecord[];
} {
  let query = `
    SELECT * FROM memories 
    WHERE is_active = 1 
      AND (is_negative_constraint = 1 OR category IN ('rule', 'architecture', 'hardware'))
  `;
  const params: any[] = [];

  if (scope !== "all") {
    query += ` AND scope IN (?, 'global')`;
    params.push(scope);
  }

  query += ` ORDER BY is_negative_constraint DESC, importance = 'critical' DESC, importance = 'high' DESC, created_at DESC`;

  const rows = db.query(query).all(...params) as MemoryRecord[];

  const negativeConstraints: MemoryRecord[] = [];
  const standardRules: MemoryRecord[] = [];

  for (const r of rows) {
    if (r.is_negative_constraint) {
      negativeConstraints.push(r);
    } else {
      standardRules.push(r);
    }
  }

  return { negativeConstraints, standardRules };
}

/**
 * Formats active rules into target format (AGENTS.md, .cursorrules, CLAUDE.md, or system prompt).
 */
export function formatRules(
  negativeConstraints: MemoryRecord[],
  standardRules: MemoryRecord[],
  format: RuleFormat = "agents.md"
): RuleExportResult {
  const ruleCount = negativeConstraints.length + standardRules.length;
  const negativeCount = negativeConstraints.length;

  if (ruleCount === 0) {
    return {
      content: "# Mnemosyne Active Rules\n\nNo active rules or negative constraints registered.",
      ruleCount: 0,
      negativeCount: 0,
    };
  }

  let content = "";

  if (format === "agents.md") {
    const lines: string[] = [
      "# Mnemosyne Operational Rules & Guardrails",
      "",
      "> Automatically synced by Mnemosyne Second Memory Engine.",
      "",
    ];

    if (negativeConstraints.length > 0) {
      lines.push("## Critical Guardrails & Negative Constraints");
      lines.push("> [!CAUTION]");
      lines.push("> The following actions, anti-patterns, and pitfalls are STRICTLY FORBIDDEN:");
      for (const neg of negativeConstraints) {
        lines.push(`> * **[${neg.importance.toUpperCase()}]** ${neg.content}`);
      }
      lines.push("");
    }

    if (standardRules.length > 0) {
      lines.push("## Architectural & Operational Rules");
      for (const rule of standardRules) {
        const badge = rule.importance === "critical" || rule.importance === "high" ? `[${rule.importance.toUpperCase()}] ` : "";
        lines.push(`* ${badge}${rule.content}`);
      }
      lines.push("");
    }

    content = lines.join("\n");
  } else if (format === "cursorrules" || format === "claude.md") {
    const lines: string[] = [
      "# Instructions & Rules (Synced from Mnemosyne)",
      "",
    ];

    if (negativeConstraints.length > 0) {
      lines.push("### STRICT RESTRICTIONS (DO NOT DO):");
      for (const neg of negativeConstraints) {
        lines.push(`- NEVER ${neg.content}`);
      }
      lines.push("");
    }

    if (standardRules.length > 0) {
      lines.push("### OPERATIONAL GUIDELINES:");
      for (const rule of standardRules) {
        lines.push(`- ${rule.content}`);
      }
      lines.push("");
    }

    content = lines.join("\n");
  } else {
    // system_prompt
    const lines: string[] = ["=== OPERATIONAL CONSTRAINTS & RULES ==="];
    for (const neg of negativeConstraints) {
      lines.push(`[FORBIDDEN] ${neg.content}`);
    }
    for (const rule of standardRules) {
      lines.push(`[RULE] ${rule.content}`);
    }
    lines.push("========================================");
    content = lines.join("\n");
  }

  return { content, ruleCount, negativeCount };
}

/**
 * Synchronizes Mnemosyne rules to an external file (e.g. AGENTS.md, .cursorrules, CLAUDE.md).
 * Uses delimiter comments to update existing sections without destroying custom file content.
 */
export function syncRulesToFile(
  db: Database,
  targetPath: string,
  format?: RuleFormat,
  scope: string = "all"
): RuleSyncResult {
  const fullPath = resolve(targetPath);
  
  // Auto-detect format from filename if not specified
  let detectedFormat: RuleFormat = format || "agents.md";
  if (!format) {
    const lower = fullPath.toLowerCase();
    if (lower.endsWith(".cursorrules")) {
      detectedFormat = "cursorrules";
    } else if (lower.endsWith("claude.md")) {
      detectedFormat = "claude.md";
    } else if (lower.endsWith("agents.md")) {
      detectedFormat = "agents.md";
    }
  }

  const { negativeConstraints, standardRules } = getActiveRules(db, scope);
  const { content, ruleCount, negativeCount } = formatRules(negativeConstraints, standardRules, detectedFormat);

  const wrappedContent = `${MARKER_START}\n${content}\n${MARKER_END}`;

  let updatedExisting = false;
  let createdNew = false;

  if (existsSync(fullPath)) {
    const existingContent = readFileSync(fullPath, "utf-8");
    if (existingContent.includes(MARKER_START) && existingContent.includes(MARKER_END)) {
      const regex = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`, "g");
      const newFileContent = existingContent.replace(regex, wrappedContent);
      writeFileSync(fullPath, newFileContent, "utf-8");
    } else {
      // Append to the existing file
      const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";
      writeFileSync(fullPath, existingContent + separator + wrappedContent + "\n", "utf-8");
    }
    updatedExisting = true;
  } else {
    // Create new file
    writeFileSync(fullPath, wrappedContent + "\n", "utf-8");
    createdNew = true;
  }

  return {
    filePath: fullPath,
    content,
    ruleCount,
    negativeCount,
    updatedExisting,
    createdNew,
  };
}
