import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { redactSecrets } from "./redact.ts";

/**
 * Raw conversation messages + the derivation queue.
 * Ingest is pure SQLite: no LLM, no embedding on the request path.
 */

export const FENCE_OPEN = "<mnemo-memory>";
export const FENCE_CLOSE = "</mnemo-memory>";
const FENCE_RE = /<mnemo-memory\b[^>]*>[\s\S]*?<\/mnemo-memory>/gi;
// Hermes' own recalled-context fence; never re-learn it either.
const HERMES_FENCE_RE = /<memory-context\b[^>]*>[\s\S]*?<\/memory-context>/gi;

export const PEER_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;
export const ROLES = ["user", "assistant", "system", "tool"] as const;
export type MessageRole = (typeof ROLES)[number];

export interface MessageInput {
  peer: string;
  session?: string;
  role?: string;
  content: string;
  ts?: number;
  source?: string;
}

export interface MessageRow {
  id: number;
  peer: string;
  session: string;
  role: string;
  content: string;
  ts: number;
  created_at: number;
  status: string;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  source: string;
}

/** Wraps injected memory so it can be stripped from captured turns later. */
export function fenceContext(text: string): string {
  return `${FENCE_OPEN}\n${text}\n${FENCE_CLOSE}`;
}

/** Removes previously injected memory so recalled context is never re-learned. */
export function stripFences(text: string): string {
  return text.replace(FENCE_RE, "").replace(HERMES_FENCE_RE, "").trim();
}

const TRIVIAL_RE =
  /^(ok(ay)?|oke|sip|siap|y(a|es|ep|up)?|no|nope|k|thx|thanks?( you)?|makasih|terima kasih|mantap|nice|cool|lol|wkwk+|hmm+|gas|lanjut|continue|go on|\?|!|\.)+[\s.!?]*$/i;

/** Turns that carry nothing worth learning ("ok", "thanks", empty). */
export function isTrivialMessage(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return true;
  return TRIVIAL_RE.test(t);
}

function sha(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export function validatePeer(peer: unknown): string {
  if (typeof peer !== "string" || !PEER_RE.test(peer)) {
    throw new Error("invalid peer: use 1-64 chars of [A-Za-z0-9_.:@-]");
  }
  return peer;
}

export interface IngestMessagesResult {
  ingested: number;
  duplicates: number;
  skipped: number;
  ids: number[];
}

/**
 * Appends messages and enqueues them for derivation. Idempotent: a retry of the
 * same (peer, session, role, content, ts) is a no-op, so clients can retry
 * at-least-once without duplicating evidence.
 */
export function ingestMessages(db: Database, inputs: MessageInput[], opts: { skipIfSeenContent?: boolean } = {}): IngestMessagesResult {
  const now = Date.now();
  const result: IngestMessagesResult = { ingested: 0, duplicates: 0, skipped: 0, ids: [] };
  const insert = db.prepare(`
    INSERT OR IGNORE INTO messages (peer, session, role, content, ts, created_at, status, digest, content_digest, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const seen = db.prepare(`SELECT 1 FROM messages WHERE content_digest = ? LIMIT 1`);

  const tx = db.transaction(() => {
    for (const input of inputs) {
      const peer = validatePeer(input.peer);
      const session = typeof input.session === "string" && input.session.trim() ? input.session.trim().slice(0, 128) : "default";
      const role = (ROLES as readonly string[]).includes(String(input.role)) ? String(input.role) : "user";
      if (typeof input.content !== "string") throw new Error("content must be a string");
      const content = redactSecrets(stripFences(input.content)).text.slice(0, 20000);
      const ts = Number.isFinite(input.ts) ? Math.trunc(Number(input.ts)) : now;
      if (!content) {
        result.skipped++;
        continue;
      }
      const contentDigest = sha([peer, session, role, content]);
      if (opts.skipIfSeenContent && seen.get(contentDigest)) {
        result.duplicates++;
        continue;
      }
      const digest = sha([contentDigest, String(ts)]);
      // Trivial turns are kept as evidence but never sent to the LLM.
      const status = isTrivialMessage(content) || role === "tool" || role === "system" ? "skipped" : "pending";
      const res = insert.run(peer, session, role, content, ts, now, status, digest, contentDigest, input.source || "api");
      if (res.changes === 0) {
        result.duplicates++;
        continue;
      }
      result.ingested++;
      result.ids.push(Number(res.lastInsertRowid));
    }
  });
  tx();
  return result;
}

/**
 * Pre-compression checkpoint (ByteRover-style): archives the transcript that is
 * about to be compressed away. Idempotent by transcript digest; messages already
 * archived (same peer/session/role/content) are not queued twice.
 */
export function checkpointTranscript(
  db: Database,
  peer: string,
  session: string,
  messages: Array<{ role?: string; content?: unknown }>
): { checkpoint_id: string; duplicate: boolean; queued: number; message_count: number } {
  validatePeer(peer);
  const rows = messages
    .filter((m) => typeof m?.content === "string" && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: String(m.role), content: String(m.content) }));
  const digest = sha([peer, session, ...rows.map((r) => `${r.role}:${stripFences(r.content)}`)]);
  const existing = db.query(`SELECT queued, message_count FROM peer_checkpoints WHERE digest = ?`).get(digest) as
    | { queued: number; message_count: number }
    | null;
  if (existing) {
    return { checkpoint_id: digest.slice(0, 16), duplicate: true, queued: 0, message_count: existing.message_count };
  }
  const base = Date.now();
  const res = ingestMessages(
    db,
    rows.map((r, i) => ({ peer, session, role: r.role, content: r.content, ts: base + i, source: "checkpoint" })),
    { skipIfSeenContent: true }
  );
  db.prepare(
    `INSERT OR IGNORE INTO peer_checkpoints (digest, peer, session, message_count, queued, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(digest, peer, session, rows.length, res.ingested, base);
  return { checkpoint_id: digest.slice(0, 16), duplicate: false, queued: res.ingested, message_count: rows.length };
}

export function getMessagesByIds(db: Database, ids: number[]): MessageRow[] {
  const clean = ids.filter((n) => Number.isInteger(n)).slice(0, 200);
  if (clean.length === 0) return [];
  return db
    .query(`SELECT * FROM messages WHERE id IN (${clean.map(() => "?").join(",")}) ORDER BY id`)
    .all(...clean) as MessageRow[];
}

export function recentMessages(db: Database, peer: string, session: string | null, limit = 20): MessageRow[] {
  const rows = session
    ? db.query(`SELECT * FROM messages WHERE peer = ? AND session = ? ORDER BY id DESC LIMIT ?`).all(peer, session, limit)
    : db.query(`SELECT * FROM messages WHERE peer = ? ORDER BY id DESC LIMIT ?`).all(peer, limit);
  return (rows as MessageRow[]).reverse();
}

const STALE_CLAIM_MS = 10 * 60 * 1000;

/** Claims up to `limit` due messages of the peer with the oldest due message. */
export function claimBatch(db: Database, limit: number, now = Date.now()): { peer: string; messages: MessageRow[] } | null {
  // Release claims left behind by a crashed worker.
  db.prepare(`UPDATE messages SET status = 'pending', claimed_at = NULL WHERE status = 'processing' AND claimed_at < ?`).run(
    now - STALE_CLAIM_MS
  );
  const head = db
    .query(`SELECT peer FROM messages WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 1`)
    .get(now) as { peer: string } | null;
  if (!head) return null;
  let claimed: MessageRow[] = [];
  db.transaction(() => {
    const rows = db
      .query(`SELECT * FROM messages WHERE status = 'pending' AND next_attempt_at <= ? AND peer = ? ORDER BY id LIMIT ?`)
      .all(now, head.peer, limit) as MessageRow[];
    // Keep a batch within a sane prompt size.
    let chars = 0;
    for (const r of rows) {
      if (claimed.length > 0 && chars + r.content.length > 16000) break;
      chars += r.content.length;
      claimed.push(r);
    }
    const mark = db.prepare(`UPDATE messages SET status = 'processing', claimed_at = ? WHERE id = ? AND status = 'pending'`);
    claimed = claimed.filter((r) => mark.run(now, r.id).changes > 0);
  })();
  return claimed.length ? { peer: head.peer, messages: claimed } : null;
}

export function completeBatch(db: Database, ids: number[]): void {
  const stmt = db.prepare(`UPDATE messages SET status = 'done', claimed_at = NULL, last_error = NULL WHERE id = ?`);
  db.transaction(() => ids.forEach((id) => stmt.run(id)))();
}

/** Puts a failed batch back on the queue with capped exponential backoff (offline = just waits). */
export function failBatch(db: Database, ids: number[], error: string, now = Date.now()): void {
  const stmt = db.prepare(`
    UPDATE messages
    SET status = 'pending', claimed_at = NULL, attempts = attempts + 1, last_error = ?,
        next_attempt_at = ? + MIN(900000, 5000 * (1 << MIN(attempts, 8)))
    WHERE id = ?
  `);
  db.transaction(() => ids.forEach((id) => stmt.run(error.slice(0, 500), now, id)))();
}

export function queueStats(db: Database, now = Date.now()) {
  const rows = db.query(`SELECT status, COUNT(*) AS c FROM messages GROUP BY status`).all() as Array<{ status: string; c: number }>;
  const by = { pending: 0, processing: 0, done: 0, skipped: 0 };
  for (const r of rows) if (r.status in by) by[r.status as keyof typeof by] = r.c;
  const due = (db.query(`SELECT COUNT(*) AS c FROM messages WHERE status = 'pending' AND next_attempt_at <= ?`).get(now) as { c: number }).c;
  const nextRetry = (db.query(`SELECT MIN(next_attempt_at) AS t FROM messages WHERE status = 'pending' AND next_attempt_at > ?`).get(now) as {
    t: number | null;
  }).t;
  return { ...by, due_now: due, next_retry_at: nextRetry };
}
