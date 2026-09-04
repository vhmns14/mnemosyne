import type { Database } from "bun:sqlite";
import { cosineSimilarity, decodeVector } from "./embedder.ts";
import type { TopicCluster } from "../types.ts";

/**
 * Fast Online Leader Clustering over Float32Array embeddings
 * Groups active memories into thematic semantic clusters without heavy machine learning dependencies.
 */
export function clusterMemories(db: Database, similarityThreshold: number = 0.55): TopicCluster[] {
  const rows = db
    .query(
      `SELECT m.id, m.content, m.category, v.vector 
       FROM memories m 
       JOIN memory_vectors v ON m.id = v.memory_id 
       WHERE m.is_active = 1`
    )
    .all() as any[];

  if (rows.length === 0) return [];

  interface ClusterInternal {
    id: string;
    centroid: Float32Array;
    items: Array<{ id: string; content: string; category: string }>;
  }

  const clusters: ClusterInternal[] = [];

  for (const row of rows) {
    const vec = decodeVector(row.vector);
    if (!vec) continue;

    let bestSim = -1;
    let bestClusterIdx = -1;

    for (let c = 0; c < clusters.length; c++) {
      const sim = cosineSimilarity(vec, clusters[c].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestClusterIdx = c;
      }
    }

    if (bestSim >= similarityThreshold && bestClusterIdx !== -1) {
      clusters[bestClusterIdx].items.push({
        id: row.id,
        content: row.content,
        category: row.category,
      });
    } else {
      clusters.push({
        id: `cluster-${clusters.length + 1}`,
        centroid: vec,
        items: [{ id: row.id, content: row.content, category: row.category }],
      });
    }
  }

  // Format clusters and extract keywords
  return clusters.map((c) => {
    // Extract top frequent words from cluster contents
    const wordCounts = new Map<string, number>();
    for (const it of c.items) {
      const words = it.content.toLowerCase().split(/[\s,.;:!?/\\()\[\]{}'"]+/).filter((w) => w.length > 3);
      for (const w of words) {
        wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
      }
    }

    const sortedWords = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([w]) => w)
      .slice(0, 3);

    const label = sortedWords.length > 0 ? sortedWords.join(" / ") : `Cluster ${c.id}`;

    return {
      id: c.id,
      label,
      size: c.items.length,
      keywords: sortedWords,
      memory_ids: c.items.map((it) => it.id),
    };
  });
}
