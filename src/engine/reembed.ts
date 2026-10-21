import type { Database } from "bun:sqlite";
import { configuredEmbeddingModel, cosineSimilarity, decodeVector, embeddingModelOf, getEmbedding, LOCAL_EMBEDDING_MODEL, storeVector } from "./embedder.ts";
import { LEGACY_UNKNOWN_MODEL } from "../db/schema.ts";

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

export interface LegacyVerifyReport {
  target_model: string;
  checked: number;
  /** Proven (cosine >= threshold vs a fresh embedding) and re-tagged with target_model. */
  tagged: number;
  /** Did not match; left as unknown:legacy for `mnemo reembed`. */
  unmatched: number;
  skipped_reason?: string;
}

/**
 * Sample-reembed check for legacy vectors of unknown origin. Only runs when a remote
 * model is configured. Each checked row is re-embedded with the configured model; when
 * the fresh vector has the same dimension and cosine >= threshold (default 0.99) with
 * the stored one, the stored vector provably came from that model and is re-tagged
 * (vector kept). Anything else stays unknown:legacy. Bounded by `limit` per run and
 * stops at the first provider fallback.
 */
export async function verifyLegacyVectors(
  db: Database,
  opts: { limit?: number; threshold?: number } = {}
): Promise<LegacyVerifyReport> {
  const target = configuredEmbeddingModel();
  const report: LegacyVerifyReport = { target_model: target, checked: 0, tagged: 0, unmatched: 0 };
  if (target === LOCAL_EMBEDDING_MODEL) {
    report.skipped_reason = "no remote embedding model configured";
    return report;
  }
  const threshold = opts.threshold ?? 0.99;
  const rows = db
    .query(
      `SELECT v.memory_id, v.vector, v.dimension, m.content FROM memory_vectors v JOIN memories m ON m.id = v.memory_id
       WHERE v.model = ? ORDER BY m.updated_at DESC LIMIT ?`
    )
    .all(LEGACY_UNKNOWN_MODEL, opts.limit ?? 20) as Array<{ memory_id: string; vector: any; dimension: number; content: string }>;
  const tag = db.prepare("UPDATE memory_vectors SET model = ? WHERE memory_id = ? AND model = ?");
  for (const r of rows) {
    const fresh = await getEmbedding(r.content);
    if (embeddingModelOf(fresh) !== target) {
      report.skipped_reason = "embedding provider unreachable";
      break;
    }
    report.checked++;
    const stored = decodeVector(r.vector);
    if (stored && stored.length === fresh.length && cosineSimilarity(stored, fresh) >= threshold) {
      tag.run(target, r.memory_id, LEGACY_UNKNOWN_MODEL);
      report.tagged++;
    } else {
      report.unmatched++;
    }
  }
  return report;
}

/** One-line daemon hint when unknown:legacy vectors exist, else null. */
export function legacyVectorHint(db: Database): string | null {
  let n = 0;
  try {
    n = (db.query("SELECT COUNT(*) AS n FROM memory_vectors WHERE model = ?").get(LEGACY_UNKNOWN_MODEL) as { n: number }).n;
  } catch {
    return null;
  }
  if (!n) return null;
  return `[mnemo] ${n} legacy vector(s) of unknown model are excluded from vector search (lexical fallback); run \`mnemo reembed\` to re-embed them.`;
}
