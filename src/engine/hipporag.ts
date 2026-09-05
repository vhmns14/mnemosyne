import type { Database } from "bun:sqlite";
import { STOPWORDS } from "./embedder.ts";
import type { ScoredMemory, EntityTriple } from "../types.ts";

const GENERIC_ENTITIES = new Set([
  "thing", "something", "data", "code", "file", "app", "application",
  "system", "user", "agent", "item", "value", "ini", "itu", "hal", "barang"
]);

/**
 * Recognition Memory Gating (HippoRAG 2):
 * Filters out high-entropy / generic / stopword entities to prevent hub leakage
 * before constructing the bipartite transition matrix.
 */
export function isInformativeEntity(entity: string): boolean {
  if (!entity) return false;
  const clean = entity.trim().toLowerCase();
  if (clean.length <= 2) return false;
  if (STOPWORDS.has(clean) || GENERIC_ENTITIES.has(clean)) return false;
  return true;
}

/**
 * Stanford HippoRAG 2: Heterogeneous Bipartite Graph Personalized PageRank (PPR)
 * Synthesizes neurobiologically inspired hippocampal indexing over neocortical graphs:
 * - Co-existence of Passage Nodes (Memories) and Entity/Phrase Nodes in a single graph
 * - Recognition Memory gating: filters uninformative entities to avoid spurious shortcut hubs
 * - Teleport vector p0 diffuses energy across: Passage <-> Entity <-> Passage in < 2ms.
 */
export function computeHippoPageRank(
  db: Database,
  seedMemories: ScoredMemory[],
  limit: number = 5,
  damping: number = 0.85,
  iterations: number = 4
): ScoredMemory[] {
  if (seedMemories.length === 0) return [];

  // 1. Build Local Ego-Graph around seed memories (max 100 candidate memories)
  const seedIds = seedMemories.map((s) => s.id);
  const candidateIdSet = new Set<string>(seedIds);

  // A. 1-hop associative neighbors from associative_links
  if (seedIds.length > 0) {
    const seedPlaceholders = seedIds.map(() => "?").join(",");
    const directLinks = db
      .query(
        `SELECT target_id as neighbor_id FROM associative_links WHERE source_id IN (${seedPlaceholders})
         UNION
         SELECT source_id as neighbor_id FROM associative_links WHERE target_id IN (${seedPlaceholders})
         LIMIT 40`
      )
      .all(...seedIds, ...seedIds) as any[];

    for (const dl of directLinks) {
      if (dl.neighbor_id) candidateIdSet.add(dl.neighbor_id);
    }

    // B. Entity-connected neighbors from entity_triples
    const seedTriples = db
      .query(
        `SELECT DISTINCT subject, object FROM entity_triples 
         WHERE is_active = 1 AND memory_id IN (${seedPlaceholders}) LIMIT 40`
      )
      .all(...seedIds) as any[];

    const seedEntities: string[] = [];
    for (const st of seedTriples) {
      if (isInformativeEntity(st.subject)) seedEntities.push(st.subject);
      if (isInformativeEntity(st.object)) seedEntities.push(st.object);
    }

    if (seedEntities.length > 0) {
      const entPlaceholders = seedEntities.map(() => "?").join(",");
      const entityNeighbors = db
        .query(
          `SELECT DISTINCT memory_id FROM entity_triples 
           WHERE is_active = 1 AND (subject IN (${entPlaceholders}) OR object IN (${entPlaceholders}))
           LIMIT 40`
        )
        .all(...seedEntities, ...seedEntities) as any[];

      for (const en of entityNeighbors) {
        if (en.memory_id) candidateIdSet.add(en.memory_id);
      }
    }
  }

  const candidateIds = Array.from(candidateIdSet).slice(0, 100);
  if (candidateIds.length === 0) return seedMemories;

  const candidatePlaceholders = candidateIds.map(() => "?").join(",");
  const allActiveMemories = db
    .query(`SELECT * FROM memories WHERE is_active = 1 AND id IN (${candidatePlaceholders})`)
    .all(...candidateIds) as any[];

  if (allActiveMemories.length === 0) return seedMemories;

  // 2. Index Passage Nodes (0 to N_P - 1)
  const memoryNodeIndex = new Map<string, number>();
  const idToMemoryRow = new Map<string, any>();
  for (let i = 0; i < allActiveMemories.length; i++) {
    memoryNodeIndex.set(allActiveMemories[i].id, i);
    idToMemoryRow.set(allActiveMemories[i].id, allActiveMemories[i]);
  }
  const NP = allActiveMemories.length;

  // 3. Fetch Triples & Index Entity Nodes (NP to NP + NE - 1)
  const candidateTriples = db
    .query(
      `SELECT id, memory_id, subject, predicate, object, confidence 
       FROM entity_triples 
       WHERE is_active = 1 AND memory_id IN (${candidatePlaceholders})`
    )
    .all(...candidateIds) as any[];

  const entityNodeIndex = new Map<string, number>();
  let nextEntityIdx = NP;

  const memToTriples = new Map<string, EntityTriple[]>();

  for (const t of candidateTriples) {
    if (!memToTriples.has(t.memory_id)) memToTriples.set(t.memory_id, []);
    memToTriples.get(t.memory_id)!.push({
      id: t.id,
      subject: t.subject,
      predicate: t.predicate,
      object: t.object,
      memory_id: t.memory_id,
      confidence: t.confidence || 1.0,
      is_active: true,
      valid_from: 0,
      valid_until: null,
      created_at: 0,
    });

    const s = t.subject.toLowerCase();
    const o = t.object.toLowerCase();

    if (isInformativeEntity(s) && !entityNodeIndex.has(s)) {
      entityNodeIndex.set(s, nextEntityIdx++);
    }
    if (isInformativeEntity(o) && !entityNodeIndex.has(o)) {
      entityNodeIndex.set(o, nextEntityIdx++);
    }
  }

  const NE = entityNodeIndex.size;
  const N = NP + NE; // Total nodes in Heterogeneous Bipartite Graph

  // 4. Build Adjacency Matrix (Outgoing edges)
  const outgoing: Array<Array<{ target: number; weight: number }>> = Array.from({ length: N }, () => []);

  // A. Associative Links: Passage <-> Passage
  const links = db
    .query(
      `SELECT source_id, target_id, resonance_weight FROM associative_links 
       WHERE source_id IN (${candidatePlaceholders}) AND target_id IN (${candidatePlaceholders})`
    )
    .all(...candidateIds, ...candidateIds) as any[];

  for (const l of links) {
    const u = memoryNodeIndex.get(l.source_id);
    const v = memoryNodeIndex.get(l.target_id);
    if (u !== undefined && v !== undefined && u !== v) {
      const w = l.resonance_weight || 0.5;
      outgoing[u].push({ target: v, weight: w });
      outgoing[v].push({ target: u, weight: w });
    }
  }

  // B. Bipartite Edges: Passage <-> Entity
  for (const t of candidateTriples) {
    const u = memoryNodeIndex.get(t.memory_id);
    if (u === undefined) continue;

    const s = t.subject.toLowerCase();
    const o = t.object.toLowerCase();
    const conf = t.confidence || 1.0;

    const sNode = entityNodeIndex.get(s);
    if (sNode !== undefined) {
      outgoing[u].push({ target: sNode, weight: 0.75 * conf });
      outgoing[sNode].push({ target: u, weight: 0.75 * conf });
    }

    const oNode = entityNodeIndex.get(o);
    if (oNode !== undefined) {
      outgoing[u].push({ target: oNode, weight: 0.75 * conf });
      outgoing[oNode].push({ target: u, weight: 0.75 * conf });
    }
  }

  // 5. Initialize Personalized PageRank Vector (Teleport Vector p0)
  const p0 = new Float32Array(N);
  let seedSum = 0;

  for (const s of seedMemories) {
    const idx = memoryNodeIndex.get(s.id);
    if (idx !== undefined) {
      p0[idx] = Math.max(0.1, s.score);
      seedSum += p0[idx];
    }
  }

  if (seedSum === 0) return seedMemories;
  for (let i = 0; i < N; i++) {
    p0[i] /= seedSum;
  }

  // 6. Power Iteration: p_next = (1 - d) * p0 + d * M * p_curr
  let pCurr = new Float32Array(p0);
  let pNext = new Float32Array(N);

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < N; i++) {
      pNext[i] = (1 - damping) * p0[i];
    }

    for (let u = 0; u < N; u++) {
      const edges = outgoing[u];
      if (edges.length > 0) {
        let totalWeight = 0;
        for (let e = 0; e < edges.length; e++) totalWeight += edges[e].weight;
        const pushVal = (damping * pCurr[u]) / (totalWeight || 1);

        for (let e = 0; e < edges.length; e++) {
          const v = edges[e].target;
          pNext[v] += pushVal * edges[e].weight;
        }
      } else {
        // Dangling node: distribute to teleport vector
        const pushVal = damping * pCurr[u];
        for (let i = 0; i < N; i++) {
          pNext[i] += pushVal * p0[i];
        }
      }
    }

    // Swap buffers
    const tmp = pCurr;
    pCurr = pNext;
    pNext = tmp;
  }

  // 7. Extract Centralities & Boost Passage Scores
  const seedMap = new Map<string, ScoredMemory>();
  for (const s of seedMemories) {
    seedMap.set(s.id, s);
  }

  for (let i = 0; i < NP; i++) {
    const prScore = pCurr[i];
    const row = allActiveMemories[i];
    const attachedTriples = memToTriples.get(row.id) || [];

    if (seedMap.has(row.id)) {
      const mem = seedMap.get(row.id)!;
      mem.pagerank_score = prScore;
      mem.connected_entities = attachedTriples;
      mem.score = Math.min(1.0, Math.max(0.0, mem.score + prScore * 0.25));
    } else if (prScore > 0.05) {
      // High-centrality passage pulled via multi-hop entity walking
      let tags: string[] = [];
      try {
        tags = JSON.parse(row.tags || "[]");
      } catch {
        tags = [];
      }

      seedMap.set(row.id, {
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
        score: Math.min(1.0, Math.max(0.0, prScore * 0.4)),
        vector_score: 0,
        bm25_score: 0,
        recency_score: 0,
        resonance_boost: prScore,
        pagerank_score: prScore,
        connected_entities: attachedTriples,
      });
    }
  }

  const results = Array.from(seedMap.values());
  for (const mem of results) {
    mem.score = Math.min(1.0, Math.max(0.0, mem.score));
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
