import { cosineSimilarity, embeddingModelOf, getEmbedding } from "./embedder.ts";
import { lexicalCoverage, lexicalKeySet, lexicalTokens, type TokenKeys } from "./lexicon.ts";

/**
 * Quality gate for reflect insights. A real model sometimes "synthesised" an insight
 * that just restates one fact, or two facts that say the same thing. Rejected here:
 *  - an insight that is a near-duplicate of any single fact (lexical or semantic),
 *  - an insight that is a near-duplicate of an existing insight,
 *  - an insight whose cited sources collapse to fewer than 2 distinct facts once
 *    near-duplicate sources are merged.
 *
 * Near-duplicate: one text's content words are >= 80% covered by the other's
 * (stem/synonym aware), Jaccard-style overlap >= 0.6, or same-model embedding
 * cosine >= MNEMO_INSIGHT_DUP_COSINE (default 0.9).
 */

export const COVER_THRESHOLD = 0.8;
export const JACCARD_THRESHOLD = 0.6;

export function dupCosine(): number {
  const v = Number(process.env.MNEMO_INSIGHT_DUP_COSINE);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.9;
}

export interface Comparable {
  text: string;
  tokens: TokenKeys[];
  keys: Set<string>;
  vec: Float32Array | null;
}

export async function comparable(text: string, ignore: string[] = []): Promise<Comparable> {
  const drop = new Set(ignore.map((s) => s.toLowerCase()));
  const tokens = lexicalTokens(text, 128).filter((t) => !drop.has(t.token) && !drop.has(t.token.replace(/'s$/, "")));
  const keys = new Set<string>();
  for (const t of tokens) {
    for (const k of t.keys) keys.add(k);
    if (t.group) keys.add(t.group);
  }
  let vec: Float32Array | null = null;
  try {
    vec = await getEmbedding(text);
  } catch {
    vec = null;
  }
  return { text, tokens, keys, vec };
}

/** Why a and b are near-duplicates, or null. */
export function nearDuplicate(a: Comparable, b: Comparable): string | null {
  if (a.tokens.length && b.tokens.length) {
    const aInB = lexicalCoverage(a.tokens, b.keys);
    const bInA = lexicalCoverage(b.tokens, a.keys);
    if (aInB >= COVER_THRESHOLD) return `lexical cover ${aInB.toFixed(2)}`;
    // Jaccard over token matches: matched / (|A| + |B| - matched)
    const matched = aInB * a.tokens.length;
    const jac = matched / Math.max(1, a.tokens.length + b.tokens.length - matched);
    if (jac >= JACCARD_THRESHOLD) return `lexical overlap ${jac.toFixed(2)}`;
    if (bInA >= COVER_THRESHOLD && b.tokens.length >= a.tokens.length) return `lexical cover ${bInA.toFixed(2)}`;
  }
  if (a.vec && b.vec && embeddingModelOf(a.vec) === embeddingModelOf(b.vec) && a.vec.length === b.vec.length) {
    const cos = cosineSimilarity(a.vec, b.vec);
    if (cos >= dupCosine()) return `cosine ${cos.toFixed(2)}`;
  }
  return null;
}

/** Number of distinct items once near-duplicates are merged (greedy). */
export function distinctCount(items: Comparable[]): number {
  const reps: Comparable[] = [];
  for (const it of items) if (!reps.some((r) => nearDuplicate(it, r) || nearDuplicate(r, it))) reps.push(it);
  return reps.length;
}

export interface InsightVerdict {
  ok: boolean;
  reason?: string;
  /** Index into existingInsights when the proposal duplicates one (a possible re-observation). */
  duplicateOf?: number;
}

export function judgeInsight(
  insight: Comparable,
  sources: Comparable[],
  allFacts: Comparable[],
  existingInsights: Comparable[]
): InsightVerdict {
  for (const f of allFacts) {
    const why = nearDuplicate(insight, f);
    if (why) return { ok: false, reason: `restates a single fact (${why}): "${f.text.slice(0, 80)}"` };
  }
  for (let i = 0; i < existingInsights.length; i++) {
    const e = existingInsights[i];
    const why = nearDuplicate(insight, e) || nearDuplicate(e, insight);
    if (why) return { ok: false, reason: `duplicates an existing insight (${why})`, duplicateOf: i };
  }
  const distinct = distinctCount(sources);
  if (distinct < 2) return { ok: false, reason: `needs >= 2 distinct source facts (cited ${sources.length}, distinct ${distinct})` };
  return { ok: true };
}

/** Insights reach the peer card only at or above this trust, or once re-observed. */
export function insightCardMinTrust(): number {
  const v = Number(process.env.MNEMO_INSIGHT_CARD_TRUST);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6;
}
