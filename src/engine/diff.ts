import type { Database } from "bun:sqlite";
import type { MemoryDiffResult, WordDiffItem } from "../types.ts";

/**
 * Computes Longest Common Subsequence (LCS) based word diff between two texts.
 */
export function computeWordDiff(oldText: string, newText: string): WordDiffItem[] {
  const oldWords = oldText.trim().split(/\s+/).filter(Boolean);
  const newWords = newText.trim().split(/\s+/).filter(Boolean);

  const n = oldWords.length;
  const m = newWords.length;

  // DP table for LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  const result: WordDiffItem[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      result.unshift({ type: "unchanged", value: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", value: newWords[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      result.unshift({ type: "removed", value: oldWords[i - 1] });
      i--;
    }
  }

  return result;
}

/**
 * Renders a clean terminal/markdown git-diff style output.
 */
export function formatDiffMarkdown(diff: MemoryDiffResult): string {
  const lines: string[] = [];
  lines.push(`### 🔄 SEMANTIC MEMORY DIFF`);
  lines.push(`--- Old State: [${diff.target_a.id}] (${new Date(diff.target_a.updated_at).toISOString()})`);
  lines.push(`+++ New State: [${diff.target_b.id}] (${new Date(diff.target_b.updated_at).toISOString()})`);
  lines.push("");

  // Metadata changes
  if (diff.field_changes.category_changed) {
    lines.push(`  Category:   - ${diff.target_a.category}  ->  + ${diff.target_b.category}`);
  }
  if (diff.field_changes.importance_changed) {
    lines.push(`  Importance: - ${diff.target_a.importance}  ->  + ${diff.target_b.importance}`);
  }
  if (diff.field_changes.scope_changed) {
    lines.push(`  Scope:      - ${diff.target_a.scope}  ->  + ${diff.target_b.scope}`);
  }

  lines.push("");
  lines.push("```diff");
  lines.push(`- ${diff.target_a.content}`);
  lines.push(`+ ${diff.target_b.content}`);
  lines.push("```");

  lines.push(`\n**Summary:** ${diff.summary}`);
  return lines.join("\n");
}

/**
 * Compares two memory records or a memory and its superseded predecessor/successor.
 */
export function diffMemories(
  db: Database,
  targetA: string,
  targetB?: string
): MemoryDiffResult {
  let rowA: any = null;
  let rowB: any = null;

  if (targetB) {
    // Both IDs explicitly supplied
    rowA = db.query("SELECT * FROM memories WHERE id = ?").get(targetA.trim());
    rowB = db.query("SELECT * FROM memories WHERE id = ?").get(targetB.trim());
  } else {
    // Single ID supplied - find its superseded relationship or latest revision
    const mem = db.query("SELECT * FROM memories WHERE id = ?").get(targetA.trim()) as any;
    if (!mem) {
      throw new Error(`Memory not found: '${targetA}'`);
    }

    if (mem.superseded_by_id) {
      // mem is older, targetB is the newer superseding memory
      rowA = mem;
      rowB = db.query("SELECT * FROM memories WHERE id = ?").get(mem.superseded_by_id);
    } else {
      // Check if this memory superseded another memory
      const predecessor = db.query("SELECT * FROM memories WHERE superseded_by_id = ?").get(mem.id) as any;
      if (predecessor) {
        rowA = predecessor;
        rowB = mem;
      } else {
        // Self-comparison or no previous revision found
        rowA = mem;
        rowB = mem;
      }
    }
  }

  if (!rowA) throw new Error(`First memory record not found: '${targetA}'`);
  if (!rowB) throw new Error(`Second memory record not found: '${targetB || targetA}'`);

  const fieldChanges = {
    content_changed: rowA.content.trim() !== rowB.content.trim(),
    category_changed: rowA.category !== rowB.category,
    scope_changed: rowA.scope !== rowB.scope,
    importance_changed: rowA.importance !== rowB.importance,
  };

  const wordDiff = computeWordDiff(rowA.content, rowB.content);

  const addedWords = wordDiff.filter((w) => w.type === "added").map((w) => w.value);
  const removedWords = wordDiff.filter((w) => w.type === "removed").map((w) => w.value);

  let summary = "";
  if (!fieldChanges.content_changed && !fieldChanges.category_changed && !fieldChanges.importance_changed) {
    summary = "No semantic differences detected between records.";
  } else {
    const changes: string[] = [];
    if (removedWords.length > 0) changes.push(`Removed: "${removedWords.slice(0, 5).join(" ")}"`);
    if (addedWords.length > 0) changes.push(`Added: "${addedWords.slice(0, 5).join(" ")}"`);
    if (fieldChanges.category_changed) changes.push(`Category changed (${rowA.category} -> ${rowB.category})`);
    summary = changes.join("; ") || "Content updated.";
  }

  const result: MemoryDiffResult = {
    target_a: {
      id: rowA.id,
      content: rowA.content,
      category: rowA.category,
      scope: rowA.scope,
      importance: rowA.importance,
      status: rowA.status || (rowA.is_active ? "active" : "inactive"),
      created_at: rowA.created_at,
      updated_at: rowA.updated_at,
    },
    target_b: {
      id: rowB.id,
      content: rowB.content,
      category: rowB.category,
      scope: rowB.scope,
      importance: rowB.importance,
      status: rowB.status || (rowB.is_active ? "active" : "inactive"),
      created_at: rowB.created_at,
      updated_at: rowB.updated_at,
    },
    field_changes: fieldChanges,
    word_diff: wordDiff,
    summary,
    formatted: "",
  };

  result.formatted = formatDiffMarkdown(result);
  return result;
}
