import type { Database } from "bun:sqlite";
import { CONFIG } from "../config.ts";
import type { EntityTriple, ScoredMemory } from "../types.ts";

/**
 * Tuned Holographic Associative Spreading Activation:
 * Supports 2-hop bidirectional spreading activation with exponential decay.
 * If concept A activates B, and B strongly links to C, C receives a proportional resonance bump.
 */
export function applyAssociativeResonance(
  db: Database,
  initialMemories: ScoredMemory[],
  limit: number = 5
): ScoredMemory[] {
  if (initialMemories.length === 0) return [];

  const memoryMap = new Map<string, ScoredMemory>();
  for (const mem of initialMemories) {
    memoryMap.set(mem.id, mem);
  }

  const visitedHops = new Set<string>();

  // Helper to expand associative links for a given parent memory
  function spreadFrom(parentId: string, parentScore: number, hopFactor: number) {
    if (hopFactor < 0.25 || visitedHops.has(parentId)) return;
    visitedHops.add(parentId);

    // Bidirectional search: links where parent is source OR target, deduplicated by linked_id
    const links = db
      .query(
        `SELECT 
           CASE WHEN a.source_id = ? THEN a.target_id ELSE a.source_id END as linked_id,
           MAX(a.resonance_weight) as resonance_weight, 
           m.*
         FROM associative_links a
         JOIN memories m ON m.id = (CASE WHEN a.source_id = ? THEN a.target_id ELSE a.source_id END)
         WHERE (a.source_id = ? OR a.target_id = ?) AND m.is_active = 1
         GROUP BY linked_id`
      )
      .all(parentId, parentId, parentId, parentId) as any[];

    for (const link of links) {
      const targetId = link.linked_id;
      const boost = parentScore * link.resonance_weight * CONFIG.WEIGHTS.RESONANCE * hopFactor;

      if (memoryMap.has(targetId)) {
        const existing = memoryMap.get(targetId)!;
        existing.resonance_boost = Math.max(existing.resonance_boost, boost);
        existing.score = Math.min(1.0, Math.max(0.0, existing.score + boost));
      } else {
        let tags: string[] = [];
        try {
          tags = JSON.parse(link.tags || "[]");
        } catch {
          tags = [];
        }

        const activatedMem: ScoredMemory = {
          id: link.id,
          content: link.content,
          scope: link.scope,
          category: link.category,
          importance: link.importance,
          structure_type: link.structure_type || "freeform",
          tags,
          access_count: link.access_count,
          last_accessed_at: link.last_accessed_at,
          created_at: link.created_at,
          updated_at: link.updated_at,
          superseded_by_id: link.superseded_by_id,
          is_active: Boolean(link.is_active),
          valid_from: link.valid_from || 0,
          valid_until: link.valid_until,
          outcome: link.outcome || "neutral",
          failure_reason: link.failure_reason,
          is_negative_constraint: Boolean(link.is_negative_constraint),
          score: Math.min(1.0, Math.max(0.0, boost)),
          vector_score: 0,
          bm25_score: 0,
          recency_score: 0,
          resonance_boost: boost,
        };

        memoryMap.set(targetId, activatedMem);

        // 2nd hop propagation with decay
        spreadFrom(targetId, boost, hopFactor * 0.5);
      }
    }
  }

  // Hop 1: Spread from top 3 initial memories
  const topSeeds = initialMemories.slice(0, 3);
  for (const seed of topSeeds) {
    spreadFrom(seed.id, seed.score, 1.0);
  }

  // Attach connected graph triples
  const memoryIds = Array.from(memoryMap.keys());
  if (memoryIds.length > 0) {
    const placeholders = memoryIds.map(() => "?").join(",");
    const triples = db
      .query(
        `SELECT * FROM entity_triples
         WHERE memory_id IN (${placeholders}) AND is_active = 1`
      )
      .all(...memoryIds) as any[];

    const tripleMap = new Map<string, EntityTriple[]>();
    for (const t of triples) {
      if (!tripleMap.has(t.memory_id)) {
        tripleMap.set(t.memory_id, []);
      }
      tripleMap.get(t.memory_id)!.push({
        id: t.id,
        subject: t.subject,
        predicate: t.predicate,
        object: t.object,
        memory_id: t.memory_id,
        confidence: t.confidence,
        is_active: Boolean(t.is_active),
        valid_from: t.valid_from || 0,
        valid_until: t.valid_until,
        created_at: t.created_at,
      });
    }

    for (const [id, mem] of memoryMap.entries()) {
      mem.connected_entities = tripleMap.get(id) || [];
    }
  }

  // Re-sort descending by final score
  const finalResults = Array.from(memoryMap.values());
  for (const mem of finalResults) {
    mem.score = Math.min(1.0, Math.max(0.0, mem.score));
  }
  finalResults.sort((a, b) => b.score - a.score);
  return finalResults.slice(0, limit);
}

/**
 * Records associative co-occurrence between memories recalled or used together.
 * Strengthens synaptic weight over time (Hebbian learning).
 */
export function recordCoOccurrence(db: Database, memoryIds: string[]): void {
  const uniqueIds = Array.from(new Set(memoryIds)).slice(0, 8);
  if (uniqueIds.length < 2) return;

  const now = Date.now();
  const upsertStmt = db.prepare(`
    INSERT INTO associative_links (source_id, target_id, resonance_weight, co_occurrences, last_linked_at)
    VALUES (?, ?, 0.5, 1, ?)
    ON CONFLICT(source_id, target_id) DO UPDATE SET
      co_occurrences = co_occurrences + 1,
      resonance_weight = MIN(0.95, resonance_weight + 0.05),
      last_linked_at = ?
  `);

  for (let i = 0; i < uniqueIds.length; i++) {
    for (let j = 0; j < uniqueIds.length; j++) {
      if (i !== j) {
        upsertStmt.run(uniqueIds[i], uniqueIds[j], now, now);
      }
    }
  }
}
