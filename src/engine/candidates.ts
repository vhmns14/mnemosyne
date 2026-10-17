import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { CandidateExtractionResult, MemoryCandidate, MemoryCategory } from "../types.ts";
import { extractTriples, isTransactionalNoise, rememberMemory } from "./dialectic.ts";

/**
 * Candidate queue (F3): the growth engine.
 *
 * Ingest already appends every turn to `notes`, but nothing turned those turns
 * into memory — growth depended on the model volunteering a `remember_memory`
 * call. Here each ingested turn is scored deterministically; clear keeper
 * statements become memories immediately, borderline ones wait for review
 * instead of silently rotting in notes.
 */
const AUTO_PROMOTE_THRESHOLD = 0.8;
const MIN_STAGE_THRESHOLD = 0.5;

/**
 * Only guardrail-class statements promote themselves: a "never do X" that the
 * agent said in chat must be live before the next tool call. Everything else
 * waits — the delta dreamer already owns note→fact promotion, and two paths
 * racing to promote the same note is how facts get written twice.
 */
const AUTO_PROMOTE_CATEGORIES: Record<string, true> = {
  negative_constraint: true,
  rule: true,
  hardware: true,
};

const IMPERATIVE =
  /\b(selalu|jangan|harus|wajib|pakai|gunakan|prefer|lebih baik|daripada|instead of|always|never|must|should|prefer|avoid|do not use)\b/i;
const NEGATIVE = /\b(jangan|dilarang|never|must not|do not|don't|hindari|anti-pattern|tidak boleh)\b/i;
const PREFERENCE = /\b(prefer|lebih baik|suka|favorit|favourite|instead of)\b/i;

export interface CandidateScore {
  confidence: number;
  reason: string;
  category: MemoryCategory;
  triples: Array<{ subject: string; predicate: string; object: string }>;
}

/**
 * Deterministic scoring — no LLM, no tokens, ~0.05ms.
 */
export function scoreCandidate(content: string): CandidateScore {
  const text = content.trim();
  const triples = extractTriples(text);
  const reasons: string[] = [];
  let confidence = 0.45;

  if (triples.length > 0) {
    confidence += 0.2;
    reasons.push(`${triples.length} triple(s) extracted`);
  }
  if (IMPERATIVE.test(text)) {
    confidence += 0.15;
    reasons.push("imperative/preference wording");
  }
  if (NEGATIVE.test(text)) {
    confidence += 0.3;
    reasons.push("negative constraint wording");
  }
  if (text.length >= 30 && text.length <= 250) {
    confidence += 0.05;
    reasons.push("information-dense length");
  }

  const category: MemoryCategory = NEGATIVE.test(text)
    ? "negative_constraint"
    : PREFERENCE.test(text)
      ? "preference"
      : triples.length > 0
        ? "architecture"
        : "fact";

  return {
    confidence: Math.min(0.95, Number(confidence.toFixed(2))),
    reason: reasons.join(", ") || "generic statement",
    category,
    triples,
  };
}

/**
 * Stages (and possibly auto-promotes) one ingested turn.
 */
export async function stageCandidates(
  db: Database,
  content: string,
  options: { session_id?: string | null; source?: string; peer?: string } = {}
): Promise<CandidateExtractionResult> {
  const result: CandidateExtractionResult = { stored: 0, promoted: 0, pending: 0, candidate_ids: [] };

  // Explicit prohibition wording outranks the chatter heuristic: a guardrail that
  // happens to name a build command ("jangan build opennextjs-cloudflare") is a rule,
  // not progress noise.
  if (isTransactionalNoise(content) && !NEGATIVE.test(content)) return result;

  const scored = scoreCandidate(content);
  if (scored.confidence < MIN_STAGE_THRESHOLD) return result;

  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO memory_candidates (id, session_id, content, triples, confidence, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    id,
    options.session_id ?? null,
    content.trim(),
    JSON.stringify(scored.triples),
    scored.confidence,
    options.source ?? "ingest",
    now
  );

  result.stored = 1;
  result.candidate_ids.push(id);

  if (scored.confidence >= AUTO_PROMOTE_THRESHOLD && AUTO_PROMOTE_CATEGORIES[scored.category] === true) {
    const memoryId = await rememberMemory(db, {
      content: content.trim(),
      category: scored.category,
      peer: options.peer ?? "user",
      source_session: options.session_id ?? null,
      importance: scored.category === "negative_constraint" ? "high" : "normal",
      is_negative_constraint: scored.category === "negative_constraint",
      skip_note_log: true,
    });
    db.prepare(
      "UPDATE memory_candidates SET status = 'promoted', promoted_memory_id = ?, decided_at = ? WHERE id = ?"
    ).run(memoryId, Date.now(), id);
    result.promoted = 1;
  } else {
    result.pending = 1;
  }

  return result;
}

export function listCandidates(db: Database, status: string = "pending", limit: number = 20): MemoryCandidate[] {
  const rows = db
    .query("SELECT * FROM memory_candidates WHERE status = ? ORDER BY confidence DESC, created_at DESC LIMIT ?")
    .all(status, limit) as Array<Omit<MemoryCandidate, "triples"> & { triples: string }>;

  return rows.map((row) => ({
    ...row,
    triples: safeParseTriples(row.triples),
  }));
}

function safeParseTriples(raw: string): Array<{ subject: string; predicate: string; object: string }> {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as Array<{ subject: string; predicate: string; object: string }>) : [];
  } catch {
    return [];
  }
}

export async function promoteCandidate(db: Database, candidateId: string): Promise<string | null> {
  const row = db.query("SELECT * FROM memory_candidates WHERE id = ?").get(candidateId) as
    | (Omit<MemoryCandidate, "triples"> & { triples: string })
    | null;
  if (!row || row.status === "promoted") return row?.promoted_memory_id ?? null;

  const scored = scoreCandidate(row.content);
  const memoryId = await rememberMemory(db, {
    content: row.content,
    category: scored.category,
    source_session: row.session_id,
    importance: scored.category === "negative_constraint" ? "high" : "normal",
    is_negative_constraint: scored.category === "negative_constraint",
    skip_note_log: true,
  });

  db.prepare(
    "UPDATE memory_candidates SET status = 'promoted', promoted_memory_id = ?, decided_at = ? WHERE id = ?"
  ).run(memoryId, Date.now(), candidateId);

  return memoryId;
}

export function rejectCandidate(db: Database, candidateId: string): boolean {
  const res = db
    .prepare("UPDATE memory_candidates SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(Date.now(), candidateId);
  return res.changes > 0;
}
