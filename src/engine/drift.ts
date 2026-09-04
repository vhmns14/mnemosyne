import type { Database } from "bun:sqlite";
import { cosineSimilarity, decodeVector, getEmbedding } from "./embedder.ts";
import type { DriftAlert } from "../types.ts";

/**
 * Semantic Drift Radar
 * Compares incoming memory against existing beliefs and flags sharp divergence.
 */
export async function detectSemanticDrift(
  db: Database,
  incomingText: string,
  threshold: number = 0.40
): Promise<DriftAlert> {
  const incomingVec = await getEmbedding(incomingText);

  // Fetch active memories
  const activeRows = db
    .query(
      `SELECT m.id, m.content, v.vector 
       FROM memories m 
       JOIN memory_vectors v ON m.id = v.memory_id 
       WHERE m.is_active = 1`
    )
    .all() as any[];

  let highestSim = 0;
  let mostSimilarId: string | undefined;
  let mostSimilarContent: string | undefined;

  for (const row of activeRows) {
    const memVec = decodeVector(row.vector);
    if (!memVec) continue;

    const sim = cosineSimilarity(incomingVec, memVec);
    if (sim > highestSim) {
      highestSim = sim;
      mostSimilarId = row.id;
      mostSimilarContent = row.content;
    }
  }

  // If high similarity exists but text is not identical, check if there's a conflict
  if (highestSim >= threshold && mostSimilarContent) {
    const lowerIn = incomingText.toLowerCase();
    const lowerOld = mostSimilarContent.toLowerCase();

    // Check for contrast markers (e.g. fastify vs hono, npm vs bun, build local vs build cloud)
    const hasExplicitContrastMarker =
      lowerIn.includes("bukan") ||
      lowerIn.includes("instead") ||
      lowerIn.includes("switch") ||
      lowerIn.includes("migrasi") ||
      lowerIn.includes("replace") ||
      lowerIn.includes("jangan");

    const hasConflictingTech =
      (lowerIn.includes("node") && !lowerIn.includes("bukan node") && lowerOld.includes("bun") && !lowerOld.includes("node")) ||
      (lowerIn.includes("fastify") && !lowerIn.includes("bukan fastify") && lowerOld.includes("hono") && !lowerOld.includes("fastify")) ||
      (lowerIn.includes("hono") && !lowerIn.includes("bukan hono") && lowerOld.includes("fastify") && !lowerOld.includes("hono"));

    const hasContrast = hasExplicitContrastMarker || hasConflictingTech;

    if (hasContrast) {
      return {
        is_drift: true,
        divergence_score: parseFloat(highestSim.toFixed(2)),
        conflicting_memory_id: mostSimilarId,
        explanation: `Potential belief drift detected against: "${mostSimilarContent}". Consider using --supersede to resolve.`,
      };
    }
  }

  return {
    is_drift: false,
    divergence_score: parseFloat(highestSim.toFixed(2)),
  };
}
