import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { MemoryScope, ReflectionRecord } from "../types.ts";

/**
 * Higher-Order Reflection Engine (Stanford Generative Agents & A-MEM)
 * Consolidates multiple atomic memory items into synthesized high-level reflections.
 */

export function synthesizeReflection(
  db: Database,
  topic: string,
  scope: MemoryScope = "global"
): ReflectionRecord | null {
  // 1. Fetch top related active memories for this topic
  let sql = `
    SELECT id, content, category, importance
    FROM memories
    WHERE is_active = 1 AND (content LIKE ? OR category LIKE ?)
  `;
  const params: any[] = [`%${topic}%`, `%${topic}%`];

  if (scope !== "global") {
    sql += ` AND scope = ?`;
    params.push(scope);
  }

  sql += ` ORDER BY importance DESC, last_accessed_at DESC LIMIT 10`;

  const related = db.query(sql).all(...params) as any[];
  if (related.length === 0) return null;

  const id = randomUUID();
  const now = Date.now();
  const memoryIds = related.map((r) => r.id);

  // Group facts and rules
  const rules = related.filter((r) => r.category === "rule" || r.category === "hardware" || r.category === "negative_constraint");
  const facts = related.filter((r) => r.category !== "rule" && r.category !== "hardware" && r.category !== "negative_constraint");

  const abstractionLines: string[] = [
    `Thematic Synthesis on "${topic}":`,
  ];

  if (rules.length > 0) {
    abstractionLines.push(`Key Directives: ${rules.map((r) => r.content).join(" | ")}`);
  }
  if (facts.length > 0) {
    abstractionLines.push(`Architectural Patterns: ${facts.map((r) => r.content).join(" | ")}`);
  }

  const abstraction = abstractionLines.join("\n");

  db.prepare(`
    INSERT INTO reflections (id, topic, abstraction, source_memory_ids, scope, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, topic, abstraction, JSON.stringify(memoryIds), scope, now);

  return {
    id,
    topic,
    abstraction,
    source_memory_ids: memoryIds,
    scope,
    created_at: now,
  };
}

export function getReflections(db: Database, topic?: string): ReflectionRecord[] {
  let sql = "SELECT * FROM reflections";
  const params: any[] = [];

  if (topic) {
    sql += " WHERE topic LIKE ?";
    params.push(`%${topic}%`);
  }

  sql += " ORDER BY created_at DESC LIMIT 20";

  const rows = db.query(sql).all(...params) as any[];
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    abstraction: r.abstraction,
    source_memory_ids: JSON.parse(r.source_memory_ids || "[]"),
    scope: r.scope,
    created_at: r.created_at,
  }));
}
