import type { Database } from "bun:sqlite";
import type { ScoredMemory } from "../types.ts";

/**
 * Stanford HippoRAG-inspired Personalized PageRank (PPR) Engine
 * Mimics hippocampal indexing over neocortical associative graph:
 * Instead of shallow 1-hop search, computes random walk with restart (PPR)
 * to uncover non-obvious multi-hop associations in <1ms.
 */
export function computeHippoPageRank(
  db: Database,
  seedMemories: ScoredMemory[],
  limit: number = 5,
  damping: number = 0.85,
  iterations: number = 4
): ScoredMemory[] {
  if (seedMemories.length === 0) return [];

  // 1. Build Local Ego-Graph around seed memories (max 100 nodes, 2-hop bounded)
  const seedIds = seedMemories.map((s) => s.id);
  const candidateIdSet = new Set<string>(seedIds);

  // A. Find 1-hop associative neighbors
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

    // B. Find entity-connected neighbors (1-hop via shared subjects/objects)
    const seedTriples = db
      .query(
        `SELECT DISTINCT subject, object FROM entity_triples 
         WHERE is_active = 1 AND memory_id IN (${seedPlaceholders}) LIMIT 30`
      )
      .all(...seedIds) as any[];

    const seedEntities: string[] = [];
    for (const st of seedTriples) {
      if (st.subject) seedEntities.push(st.subject);
      if (st.object) seedEntities.push(st.object);
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
  const allActive = db
    .query(`SELECT * FROM memories WHERE is_active = 1 AND id IN (${candidatePlaceholders})`)
    .all(...candidateIds) as any[];

  if (allActive.length === 0) return seedMemories;

  const nodeIndex = new Map<string, number>();
  const idToRow = new Map<string, any>();
  for (let i = 0; i < allActive.length; i++) {
    nodeIndex.set(allActive[i].id, i);
    idToRow.set(allActive[i].id, allActive[i]);
  }

  const N = allActive.length;

  // 2. Build Adjacency Matrix from Associative Links & Entity Triples
  const outgoing: Array<Array<{ target: number; weight: number }>> = Array.from({ length: N }, () => []);

  // A. Add associative links for subgraph nodes
  const links = db
    .query(
      `SELECT source_id, target_id, resonance_weight FROM associative_links 
       WHERE source_id IN (${candidatePlaceholders}) AND target_id IN (${candidatePlaceholders})`
    )
    .all(...candidateIds, ...candidateIds) as any[];

  for (const l of links) {
    const u = nodeIndex.get(l.source_id);
    const v = nodeIndex.get(l.target_id);
    if (u !== undefined && v !== undefined && u !== v) {
      outgoing[u].push({ target: v, weight: l.resonance_weight || 0.5 });
      outgoing[v].push({ target: u, weight: l.resonance_weight || 0.5 });
    }
  }

  // B. Add Shared Entity Links from entity_triples (capped degree to avoid clique explosion)
  const triples = db
    .query(
      `SELECT memory_id, subject, object FROM entity_triples 
       WHERE is_active = 1 AND memory_id IN (${candidatePlaceholders})`
    )
    .all(...candidateIds) as any[];

  const entityToMems = new Map<string, number[]>();
  for (const t of triples) {
    const u = nodeIndex.get(t.memory_id);
    if (u !== undefined) {
      const sKey = `S:${t.subject.toLowerCase()}`;
      const oKey = `O:${t.object.toLowerCase()}`;
      if (!entityToMems.has(sKey)) entityToMems.set(sKey, []);
      if (!entityToMems.has(oKey)) entityToMems.set(oKey, []);
      entityToMems.get(sKey)!.push(u);
      entityToMems.get(oKey)!.push(u);
    }
  }

  // Connect memories sharing the same entity (degree capped to max 8 nodes per entity)
  for (const memList of entityToMems.values()) {
    const boundedList = memList.slice(0, 8);
    if (boundedList.length > 1) {
      for (let i = 0; i < boundedList.length; i++) {
        for (let j = i + 1; j < boundedList.length; j++) {
          const u = boundedList[i];
          const v = boundedList[j];
          if (u !== v) {
            outgoing[u].push({ target: v, weight: 0.6 });
            outgoing[v].push({ target: u, weight: 0.6 });
          }
        }
      }
    }
  }

  // 3. Initialize Personalized PageRank Vector (Teleport vector p0)
  const p0 = new Float32Array(N);
  let seedSum = 0;
  for (const s of seedMemories) {
    const idx = nodeIndex.get(s.id);
    if (idx !== undefined) {
      p0[idx] = Math.max(0.1, s.score);
      seedSum += p0[idx];
    }
  }

  if (seedSum === 0) return seedMemories;
  for (let i = 0; i < N; i++) {
    p0[i] /= seedSum;
  }

  // 4. Power Iteration: p_next = (1 - d) * p0 + d * M * p_curr
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
        // Dangling node: redistribute to teleport vector
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

  // 5. Merge PageRank scores into seed memories & activate central graph nodes
  const seedMap = new Map<string, ScoredMemory>();
  for (const s of seedMemories) {
    seedMap.set(s.id, s);
  }

  for (let i = 0; i < N; i++) {
    const prScore = pCurr[i];
    const row = allActive[i];

    if (seedMap.has(row.id)) {
      const mem = seedMap.get(row.id)!;
      mem.pagerank_score = prScore;
      mem.score = Math.min(1.0, Math.max(0.0, mem.score + prScore * 0.25)); // Boost score via PageRank graph centrality
    } else if (prScore > 0.08) {
      // High PageRank node pulled from graph!
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
