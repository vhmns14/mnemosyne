import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { STOPWORDS } from "./embedder.ts";
import type { CommunitySummaryRecord, CommunitySummaryInput } from "../types.ts";

const GENERIC_ENTITIES = new Set([
  "thing", "something", "data", "code", "file", "app", "application",
  "system", "user", "agent", "item", "value", "ini", "itu", "hal", "barang"
]);

/**
 * Filter out generic/stopword entities to keep community summaries focused.
 */
function isInformative(entity: string): boolean {
  const clean = entity.trim().toLowerCase();
  if (clean.length <= 2) return false;
  if (STOPWORDS.has(clean) || GENERIC_ENTITIES.has(clean)) return false;
  return true;
}

/**
 * Detects communities over the active memory and entity-triple graph
 * and generates high-level hierarchical community summaries (Graphiti / GraphRAG style).
 */
export function detectAndSummarizeCommunities(db: Database): CommunitySummaryRecord[] {
  const now = Date.now();

  // 1. Fetch active memories & active triples
  const memories = db
    .query("SELECT id, content, category, tags, is_negative_constraint FROM memories WHERE is_active = 1")
    .all() as any[];

  if (memories.length === 0) return [];

  const triples = db
    .query("SELECT memory_id, subject, predicate, object FROM entity_triples WHERE is_active = 1")
    .all() as any[];

  // 2. Build Adjacency Graph between memories (via shared triples, categories, and tags)
  const memMap = new Map<string, any>();
  for (const m of memories) {
    memMap.set(m.id, m);
  }

  const entityToMems = new Map<string, Set<string>>();
  for (const t of triples) {
    if (t.memory_id && memMap.has(t.memory_id)) {
      const s = t.subject.toLowerCase();
      const o = t.object.toLowerCase();
      if (isInformative(s)) {
        if (!entityToMems.has(s)) entityToMems.set(s, new Set());
        entityToMems.get(s)!.add(t.memory_id);
      }
      if (isInformative(o)) {
        if (!entityToMems.has(o)) entityToMems.set(o, new Set());
        entityToMems.get(o)!.add(t.memory_id);
      }
    }
  }

  // Also group by tag
  for (const m of memories) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(m.tags || "[]");
    } catch {
      tags = [];
    }
    for (const tag of tags) {
      const cleanTag = tag.toLowerCase().trim();
      if (cleanTag.length > 2 && !STOPWORDS.has(cleanTag)) {
        if (!entityToMems.has(cleanTag)) entityToMems.set(cleanTag, new Set());
        entityToMems.get(cleanTag)!.add(m.id);
      }
    }
  }

  // 3. Connected Components / Community Clustering
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) {
      parent.set(x, find(parent.get(x)!));
    }
    return parent.get(x)!;
  }

  function union(x: string, y: string) {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  }

  for (const [_, memSet] of entityToMems.entries()) {
    const arr = Array.from(memSet);
    for (let i = 0; i < arr.length - 1; i++) {
      union(arr[i], arr[i + 1]);
    }
  }

  // Group memories into community clusters
  const clusters = new Map<string, string[]>();
  for (const m of memories) {
    const root = find(m.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(m.id);
  }

  // 4. Generate Summaries for Each Community
  const results: CommunitySummaryRecord[] = [];
  let commIdx = 1;

  for (const [_, memberIds] of clusters.entries()) {
    if (memberIds.length === 0) continue;

    const memberRows = memberIds.map((id) => memMap.get(id)).filter(Boolean);
    const commId = `comm-${commIdx++}`;

    // Extract top entities present in this community
    const entityFreq = new Map<string, number>();
    for (const [ent, set] of entityToMems.entries()) {
      let overlap = 0;
      for (const id of memberIds) {
        if (set.has(id)) overlap++;
      }
      if (overlap > 0) {
        entityFreq.set(ent, overlap);
      }
    }

    const topEntities = Array.from(entityFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ent]) => ent);

    // Determine category theme
    const categoryCounts = new Map<string, number>();
    let hasRules = false;
    for (const m of memberRows) {
      categoryCounts.set(m.category, (categoryCounts.get(m.category) || 0) + 1);
      if (m.is_negative_constraint) hasRules = true;
    }

    const dominantCategory = Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "fact";

    // Generate readable community label
    let label = "";
    if (hasRules && dominantCategory === "rule") {
      label = `Safety & Constraints: ${topEntities.slice(0, 2).join(", ") || "Guardrails"}`;
    } else if (topEntities.length > 0) {
      label = `${dominantCategory.toUpperCase()}: ${topEntities.slice(0, 3).join(" / ")}`;
    } else {
      label = `${dominantCategory.toUpperCase()} Cluster (${memberRows.length} items)`;
    }

    // Generate concise multi-sentence summary
    const summaryStatements = memberRows
      .slice(0, 4)
      .map((m) => m.content.trim().replace(/\.$/, ""))
      .join(". ");

    const summary = `${label}. Comprises ${memberRows.length} linked memories: ${summaryStatements}.`;

    // 5. Store / Upsert in community_summaries
    const existing = db
      .query("SELECT id FROM community_summaries WHERE community_id = ?")
      .get(commId) as any;

    const id = existing ? existing.id : randomUUID();

    db.prepare(`
      INSERT OR REPLACE INTO community_summaries (
        id, community_id, label, summary, key_entities, member_memory_ids, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      commId,
      label,
      summary,
      JSON.stringify(topEntities),
      JSON.stringify(memberIds),
      now,
      now
    );

    results.push({
      id,
      community_id: commId,
      label,
      summary,
      key_entities: topEntities,
      member_memory_ids: memberIds,
      created_at: now,
      updated_at: now,
    });
  }

  return results;
}

/**
 * Retrieves all stored community summaries.
 */
export function getCommunitySummaries(db: Database, limit: number = 20): CommunitySummaryRecord[] {
  const rows = db
    .query("SELECT * FROM community_summaries ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    community_id: r.community_id,
    label: r.label,
    summary: r.summary,
    key_entities: JSON.parse(r.key_entities || "[]"),
    member_memory_ids: JSON.parse(r.member_memory_ids || "[]"),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}
