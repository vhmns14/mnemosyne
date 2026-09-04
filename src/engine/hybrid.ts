import type { Database } from "bun:sqlite";
import { CONFIG } from "../config.ts";
import { cosineSimilarity, decodeVector, getEmbedding } from "./embedder.ts";
import type { MemoryRecord, RecallOptions, ScoredMemory } from "../types.ts";

import * as os from "node:os";

/**
 * Calculates category-differentiated recency decay:
 * - Stable facts (preference, hardware, architecture, rule): 180 days half-life (high baseline)
 * - Temporal facts (task_progress, episodic, session): 1 day half-life (rapid decay)
 */
export function calculateRecencyScore(
  lastAccessedAtMs: number,
  halfLifeDays: number = CONFIG.RECENCY_HALF_LIFE_DAYS,
  category?: string
): number {
  const now = Date.now();
  const elapsedDays = Math.max(0, (now - lastAccessedAtMs) / (1000 * 60 * 60 * 24));
  
  let effectiveHalfLife = halfLifeDays;
  if (category === "preference" || category === "hardware" || category === "architecture" || category === "rule") {
    effectiveHalfLife = 180.0; // Stable truths
  } else if (category === "task_progress" || category === "episodic" || category === "session") {
    effectiveHalfLife = 1.0; // Rapid decay for transient task progress
  }

  const lambda = Math.LN2 / effectiveHalfLife;
  return Math.exp(-lambda * elapsedDays);
}

/**
 * Tuned Hybrid Search Engine:
 * 1. Semantic Vector Cosine Similarity (Dense)
 * 2. SQLite FTS5 Multi-Match Lexical Search (Phrase + Prefix)
 * 3. Semantic Relevance Gating (Recency only modulates semantically relevant records)
 * 4. Bi-Temporal Validity Filter
 * 5. Multiplier Boosts for Critical Guardrails & Failure Lessons
 */
export async function searchHybrid(
  db: Database,
  options: RecallOptions
): Promise<ScoredMemory[]> {
  const query = options.query.trim();
  if (!query) return [];

  const limit = options.limit || 5;
  const minRelevance = options.min_relevance !== undefined ? options.min_relevance : 0.2;
  const scope = options.scope || "all";
  const targetTime = options.at_timestamp || Date.now();

  // 1. Resolve query with canonical entity aliases (Cognee style)
  let resolvedQuery = query;
  try {
    const aliases = db.query("SELECT alias, canonical_name FROM entity_aliases").all() as any[];
    for (const a of aliases) {
      if (!a.alias) continue;
      const escaped = a.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(^|[^\\w])(${escaped})([^\\w]|$)`, "gi");
      resolvedQuery = resolvedQuery.replace(regex, `$1${a.canonical_name}$3`);
    }
  } catch {
    // ignore
  }

  // 2. Tuned FTS5 Lexical Search (Fast Path: BM25/FTS5 first, 0 MB extra RAM)
  const rawWords = resolvedQuery
    .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/gi, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 16);

  const ftsScores = new Map<string, number>();
  if (rawWords.length > 0) {
    const ftsQuery = rawWords.map((w) => `"${w}"*`).join(" OR ");
    try {
      const ftsRows = db
        .query(
          `SELECT memory_id, bm25(memory_fts) as rank
           FROM memory_fts
           WHERE memory_fts MATCH ?
           ORDER BY rank ASC
           LIMIT 50`
        )
        .all(ftsQuery) as any[];

      let minRank = 0;
      for (const r of ftsRows) {
        if (r.rank < minRank) minRank = r.rank;
      }
      const span = Math.abs(minRank) || 1;
      for (const r of ftsRows) {
        const normalized = Math.max(0, Math.min(1, Math.abs(r.rank) / span));
        ftsScores.set(r.memory_id, normalized);
      }
    } catch {
      // Graceful fallback
    }
  }

  // 3. RAM-Aware Embedding Fallback:
  // FTS5 + BM25 takes priority. Only invoke vector embedding if:
  // a) User didn't specify prefer_bm25
  // b) Free RAM is above 300MB (prevents laptop hang on 16GB limit)
  // c) Either FTS5 returned few matches OR hybrid is explicitly desired
  const freeMemMb = os.freemem() / (1024 * 1024);
  const shouldSkipVector = Boolean(options.prefer_bm25) || freeMemMb < 300;

  let queryVec: Float32Array | null = null;
  if (!shouldSkipVector) {
    try {
      queryVec = await getEmbedding(resolvedQuery);
    } catch {
      queryVec = null;
    }
  }

  // 4. Fetch active candidate memories with bi-temporal filtering
  let sql = `
    SELECT m.*, v.vector as vector_blob
    FROM memories m
    LEFT JOIN memory_vectors v ON m.id = v.memory_id
    WHERE m.is_active = 1
  `;
  const params: any[] = [];

  if (scope !== "all") {
    sql += ` AND (m.scope = ? OR m.scope = 'global')`;
    params.push(scope);
  }

  if (options.structure_type) {
    sql += ` AND m.structure_type = ?`;
    params.push(options.structure_type);
  }

  if (!options.include_expired) {
    sql += ` AND m.valid_from <= ? AND (m.valid_until IS NULL OR m.valid_until >= ?)`;
    params.push(targetTime, targetTime);
  }

  const candidateRows = db.query(sql).all(...params) as any[];
  if (candidateRows.length === 0) return [];

  // 5. Calculate Scored Memories with Relevance Gating
  const scoredMemories: ScoredMemory[] = [];
  const { VECTOR, BM25, RECENCY } = CONFIG.WEIGHTS;

  for (const row of candidateRows) {
    // A. Vector Score
    let vectorScore = 0;
    if (queryVec && row.vector_blob) {
      const memVec = decodeVector(row.vector_blob);
      if (memVec) {
        vectorScore = Math.max(0, cosineSimilarity(queryVec, memVec));
      }
    }

    // B. BM25 Score
    const bm25Score = ftsScores.get(row.id) || 0;

    // C. Semantic / Lexical Relevance Gating:
    // If vector is skipped, BM25 acts as primary signal.
    const effectiveVectorWeight = queryVec ? VECTOR : 0.0;
    const effectiveBm25Weight = queryVec ? BM25 : 0.70;
    const signal = vectorScore * effectiveVectorWeight + bm25Score * effectiveBm25Weight;

    if (signal < 0.05 && !row.is_negative_constraint) {
      continue; // Skip irrelevant noise
    }

    // D. Recency Score (acts as intelligent temporal booster with category awareness)
    const recencyScore = calculateRecencyScore(row.last_accessed_at, undefined, row.category);

    // E. Priority & Guardrail Multipliers
    let multiplier = 1.0;
    if (row.is_negative_constraint) multiplier *= 1.45; // Anti-pattern guardrail boost
    if (row.importance === "critical") multiplier *= 1.35;
    else if (row.importance === "high") multiplier *= 1.15;
    else if (row.importance === "low") multiplier *= 0.85;

    // Past failure lessons receive attention if semantically related
    if (row.outcome === "failure") multiplier *= 1.25;

    // Hermes Ranking: relevance × recency × confidence × ttl_weight
    const confidence = row.confidence !== undefined && row.confidence !== null ? row.confidence : 1.0;
    let ttlWeight = 1.0;
    if (row.valid_until && !options.include_expired) {
      const remainingMs = row.valid_until - targetTime;
      const totalSpan = Math.max(1, row.valid_until - (row.created_at || row.valid_from || targetTime));
      ttlWeight = remainingMs > 0 ? Math.max(0.1, remainingMs / totalSpan) : 0.8;
    }

    const rawScore = (signal + recencyScore * RECENCY) * multiplier * confidence * ttlWeight;

    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags || "[]");
    } catch {
      tags = [];
    }

    scoredMemories.push({
      id: row.id,
      content: row.content,
      scope: row.scope,
      category: row.category,
      importance: row.importance,
      structure_type: row.structure_type || "freeform",
      tags,
      access_count: row.access_count,
      last_accessed_at: row.last_accessed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      superseded_by_id: row.superseded_by_id,
      is_active: Boolean(row.is_active),
      valid_from: row.valid_from || 0,
      valid_until: row.valid_until,
      outcome: row.outcome || "neutral",
      failure_reason: row.failure_reason,
      is_negative_constraint: Boolean(row.is_negative_constraint),
      peer: row.peer,
      source_session: row.source_session,
      memory_type: row.memory_type,
      contradiction_count: row.contradiction_count,
      confidence,
      fingerprint: row.fingerprint,
      status: row.status,
      score: rawScore,
      vector_score: vectorScore,
      bm25_score: bm25Score,
      recency_score: recencyScore,
      resonance_boost: 0,
    });
  }

  // 6. Sort and apply minRelevance filter
  scoredMemories.sort((a, b) => b.score - a.score);
  const results = scoredMemories.filter((m) => m.score >= minRelevance).slice(0, limit);

  // 7. Update access count asynchronously
  if (results.length > 0) {
    const updateStmt = db.prepare(`
      UPDATE memories
      SET access_count = access_count + 1, last_accessed_at = ?
      WHERE id = ?
    `);
    const now = Date.now();
    for (const res of results) {
      updateStmt.run(now, res.id);
    }
  }

  return results;
}
