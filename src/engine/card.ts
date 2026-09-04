import type { Database } from "bun:sqlite";
import type { StandingCard } from "../types.ts";

/**
 * Layering: Standing Card (Fast Path) vs Detail Notes (Slow Path)
 * Honcho-style: Returns 10-20 active standing facts (profile, preferences, system invariants)
 * Injected every turn with 0 LLM latency, 0 vector computation, and minimal tokens.
 */
export function getStandingCard(
  db: Database,
  options: { scope?: string; limit?: number; peer?: string } = {}
): StandingCard {
  const limit = options.limit || 15;
  const scope = options.scope || "global";

  let tripleSql = `
    SELECT t.subject, t.predicate, t.object, m.category, m.importance, m.access_count
    FROM entity_triples t
    JOIN memories m ON t.memory_id = m.id
    WHERE t.is_active = 1 
      AND m.is_active = 1
      AND m.memory_type = 'declarative'
      AND (m.confidence IS NULL OR m.confidence >= 0.85)
      AND m.category NOT IN ('episodic', 'session', 'task_progress')
  `;
  const params: any[] = [];

  if (scope !== "all") {
    tripleSql += ` AND (m.scope = ? OR m.scope = 'global')`;
    params.push(scope);
  }

  if (options.peer) {
    tripleSql += ` AND (m.peer = ? OR m.peer = 'user')`;
    params.push(options.peer);
  }

  tripleSql += `
    ORDER BY m.importance = 'critical' DESC, m.importance = 'high' DESC, m.access_count DESC, t.created_at DESC
    LIMIT ?
  `;
  params.push(limit);

  const tripleRows = db.query(tripleSql).all(...params) as Array<{
    subject: string;
    predicate: string;
    object: string;
    category: string;
    importance: string;
    access_count: number;
  }>;

  const facts: StandingCard["facts"] = [];
  const lines: string[] = [];

  lines.push("### 📇 STANDING FACTS CARD (Zero-Overhead Profile)");

  if (tripleRows.length === 0) {
    lines.push("*(No standing facts recorded yet)*");
  } else {
    for (const r of tripleRows) {
      facts.push({
        subject: r.subject,
        predicate: r.predicate,
        object: r.object,
        category: r.category,
        importance: r.importance,
      });

      const badge = r.importance === "critical" ? " ⭐" : "";
      const prettyPred = r.predicate.toLowerCase().replace(/_/g, " ");
      lines.push(`- ${r.subject} ${prettyPred} ${r.object}${badge}`);
    }
  }

  const formatted = lines.join("\n");
  const tokenCount = Math.ceil(formatted.length / 4);

  return {
    facts,
    formatted,
    token_count: tokenCount,
  };
}
