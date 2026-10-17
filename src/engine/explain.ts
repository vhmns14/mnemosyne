import type { Database } from "bun:sqlite";
import type { BeliefEvidence, BeliefExplanation, MemoryCategory, MemoryScope } from "../types.ts";
import { searchHybrid } from "./hybrid.ts";
import { getUsageMap } from "./feedback.ts";
import { OPPOSITES } from "./dialectic.ts";

/**
 * Belief explanation (F6): evidence chain, contradictions, and abstention.
 *
 * Recall returns what looks relevant; it never says *why* a belief is held or
 * whether the memory actually supports the claim. An agent that can ask "why"
 * can also be told "I don't know" instead of improvising from a weak match.
 */
const DEFAULT_MIN_SCORE = 0.35;

export async function explainBelief(
  db: Database,
  claim: string,
  options: { limit?: number; min_score?: number } = {}
): Promise<BeliefExplanation> {
  const limit = options.limit ?? 5;
  const minScore = options.min_score ?? DEFAULT_MIN_SCORE;

  const scored = await searchHybrid(db, { query: claim, limit, min_relevance: 0.1 });
  const evidenceIds = scored.map((m) => m.id);

  const triplesByMemory = new Map<string, Array<{ subject: string; predicate: string; object: string }>>();
  if (evidenceIds.length > 0) {
    const placeholders = evidenceIds.map(() => "?").join(",");
    const rows = db
      .query(
        `SELECT memory_id, subject, predicate, object FROM entity_triples
         WHERE is_active = 1 AND memory_id IN (${placeholders})`
      )
      .all(...evidenceIds) as Array<{ memory_id: string; subject: string; predicate: string; object: string }>;
    for (const row of rows) {
      const list = triplesByMemory.get(row.memory_id) ?? [];
      list.push({ subject: row.subject, predicate: row.predicate, object: row.object });
      triplesByMemory.set(row.memory_id, list);
    }
  }

  const usage = getUsageMap(db, evidenceIds);

  const evidence: BeliefEvidence[] = scored.map((m) => ({
    memory_id: m.id,
    content: m.content,
    category: m.category as MemoryCategory,
    scope: m.scope as MemoryScope,
    score: Number(m.score.toFixed(4)),
    source_session: m.source_session ?? null,
    triples: triplesByMemory.get(m.id) ?? [],
    helped: usage.get(m.id)?.helped ?? 0,
    misled: usage.get(m.id)?.misled ?? 0,
  }));

  const contradictions = findContradictions(evidence);
  const top = evidence[0];
  const supported = Boolean(top && top.score >= minScore);

  const confidence = supported ? top.score : 0;
  const verdict = !supported
    ? "ABSTAIN — no memory supports this claim above the relevance threshold"
    : top.score >= 0.6
      ? "SUPPORTED — strong evidence"
      : "WEAK — top evidence is only loosely related, verify before relying on it";

  return {
    claim,
    supported,
    confidence: Number(confidence.toFixed(4)),
    verdict,
    evidence,
    contradictions,
    markdown: renderExplanation(claim, verdict, supported, evidence, contradictions, minScore),
  };
}

function findContradictions(
  evidence: BeliefEvidence[]
): Array<{ subject: string; positive: string; negative: string }> {
  const triples = evidence.flatMap((e) => e.triples);
  const found: Array<{ subject: string; positive: string; negative: string }> = [];
  const seen = new Set<string>();

  for (const a of triples) {
    const opposite = OPPOSITES[a.predicate.toUpperCase()];
    if (!opposite) continue;
    for (const b of triples) {
      if (b.predicate.toUpperCase() !== opposite) continue;
      if (a.subject.toLowerCase() !== b.subject.toLowerCase()) continue;
      if (a.object.toLowerCase() !== b.object.toLowerCase()) continue;

      const key = `${a.subject}|${a.predicate}|${b.predicate}|${a.object}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ subject: a.subject, positive: `${a.predicate} ${a.object}`, negative: `${b.predicate} ${b.object}` });
    }
  }
  return found;
}

function renderExplanation(
  claim: string,
  verdict: string,
  supported: boolean,
  evidence: BeliefEvidence[],
  contradictions: Array<{ subject: string; positive: string; negative: string }>,
  minScore: number
): string {
  const lines: string[] = [];
  lines.push(`### 🔎 Why: ${claim}`);
  lines.push(`**Verdict:** ${verdict}${supported ? ` (top score ${evidence[0]?.score ?? 0})` : ` (threshold ${minScore})`}`);
  lines.push("");

  if (!supported) {
    lines.push("_No supporting memory found. Do not assume — ask the user or verify against the codebase._");
    return lines.join("\n");
  }

  lines.push("**Evidence**");
  for (const item of evidence) {
    const usage = item.helped || item.misled ? ` • helped ${item.helped}×, misled ${item.misled}×` : "";
    lines.push(`- \`${item.memory_id}\` (${item.score}) [${item.scope}/${item.category}]${usage}`);
    lines.push(`  ${item.content.replace(/\s+/g, " ").slice(0, 240)}`);
    for (const t of item.triples) lines.push(`  └─ ${t.subject} ──[${t.predicate}]──> ${t.object}`);
  }

  if (contradictions.length > 0) {
    lines.push("");
    lines.push("**Conflicting beliefs**");
    for (const c of contradictions) {
      lines.push(`- ${c.subject}: \`${c.positive}\` vs \`${c.negative}\` — resolve before acting.`);
    }
  }

  return lines.join("\n");
}
