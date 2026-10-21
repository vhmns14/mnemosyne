import type { Database } from "bun:sqlite";
import { configuredEmbeddingModel, embeddingModelOf, getEmbedding, storeVector } from "./embedder.ts";

export interface ReembedReport {
  target_model: string;
  /** Rows whose vector is missing or from another model (before this run). */
  mismatched: number;
  by_model: Record<string, number>;
  reembedded: number;
  /** Embedding came back from a different model (provider down -> local fallback). */
  failed: number;
  dry_run: boolean;
  stopped_early: boolean;
}

/**
 * Re-embed every memory whose stored vector is missing or was produced by a model
 * other than the configured one. A vector is only written when it really came from
 * the configured model; after `maxFailures` consecutive fallbacks the run stops
 * (the provider is down, no point hammering it or writing nothing in a loop).
 */
export async function reembedMismatched(
  db: Database,
  opts: { dryRun?: boolean; all?: boolean; limit?: number; maxFailures?: number } = {}
): Promise<ReembedReport> {
  const target = configuredEmbeddingModel();
  const rows = db
    .query(
      `SELECT m.id, m.content, v.model FROM memories m LEFT JOIN memory_vectors v ON v.memory_id = m.id
       WHERE (? = 1 OR v.model IS NULL OR v.model != ?) ORDER BY m.updated_at DESC`
    )
    .all(opts.all ? 1 : 0, target) as Array<{ id: string; content: string; model: string | null }>;
  const by_model: Record<string, number> = {};
  for (const r of rows) by_model[r.model ?? "(none)"] = (by_model[r.model ?? "(none)"] || 0) + 1;
  const report: ReembedReport = {
    target_model: target,
    mismatched: rows.length,
    by_model,
    reembedded: 0,
    failed: 0,
    dry_run: Boolean(opts.dryRun),
    stopped_early: false,
  };
  if (opts.dryRun) return report;
  const limit = opts.limit && opts.limit > 0 ? opts.limit : rows.length;
  const maxFailures = opts.maxFailures ?? 5;
  let streak = 0;
  for (const r of rows.slice(0, limit)) {
    const vec = await getEmbedding(r.content);
    if (embeddingModelOf(vec) !== target) {
      report.failed++;
      if (++streak >= maxFailures) {
        report.stopped_early = true;
        break;
      }
      continue;
    }
    streak = 0;
    storeVector(db, r.id, vec);
    report.reembedded++;
  }
  return report;
}
