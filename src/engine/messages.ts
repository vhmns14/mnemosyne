import type { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { redactSecrets } from "./redact.ts";

/**
 * Raw conversation messages + the derivation queue.
 * Ingest is pure SQLite: no LLM, no embedding on the request path.
 */

export const FENCE_OPEN = "<mnemo-memory>";
export const FENCE_CLOSE = "</mnemo-memory>";
// Hermes' own recalled-context fence (it carries a fixed system note); never re-learn it either.
const HERMES_FENCE_RE = /<memory-context\b[^>]*>\s*\[System note: The following is recalled memory context[\s\S]*?<\/memory-context>/gi;
// Any fence-looking tag inside fenced content is defanged so it cannot close the fence early.
const FENCE_TAG_RE = /<(\/?)(\s*)(mnemo-memory|memory-context)/gi;

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

/**
 * Per-database fence nonce. Only fences carrying it are stripped from captured
 * turns, so text that merely *looks* like a fence (typed by the user, or inside a
 * pasted page) can never hide content from learning.
 */
export function getFenceNonce(db: Database): string {
  const row = db.query(`SELECT value FROM meta WHERE key = 'fence.nonce'`).get() as { value: string } | null;
  if (row?.value) return row.value;
  const nonce = randomBytes(9).toString("hex");
  db.prepare(`INSERT OR IGNORE INTO meta (key, value, updated_at) VALUES ('fence.nonce', ?, ?)`).run(nonce, Date.now());
  return (db.query(`SELECT value FROM meta WHERE key = 'fence.nonce'`).get() as { value: string }).value;
}

/** Neutralizes fence tags inside content (e.g. a fact that says "</mnemo-memory>"). */
export function defangFences(text: string): string {
  return text.replace(FENCE_TAG_RE, "‹$1$2$3");
}

/** Wraps injected memory so it can be stripped from captured turns later. */
export function fenceContext(text: string, nonce?: string): string {
  const open = nonce ? `<mnemo-memory data-fence="${nonce}">` : FENCE_OPEN;
  return `${open}\n${defangFences(text)}\n${FENCE_CLOSE}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Removes previously injected memory so recalled context is never re-learned.
 * With a nonce only genuine fences are removed; without one (legacy callers)
 * only Hermes' own system-noted block is removed and mnemo fences are kept.
 */
export function stripFences(text: string, nonce?: string): string {
  let out = text;
  if (nonce) {
    const re = new RegExp(`<mnemo-memory\\s+data-fence="${escapeRe(nonce)}"\\s*>[\\s\\S]*?<\\/mnemo-memory>`, "gi");
    out = out.replace(re, "");
  }
  return out.replace(HERMES_FENCE_RE, "").trim();
}

const TRIVIAL_RE =
  /^(ok(ay)?|oke|sip|siap|y(a|es|ep|up)?|no|nope|k|thx|thanks?( you)?|makasih|terima kasih|mantap|nice|cool|lol|wkwk+|hmm+|gas|lanjut|continue|go on|\?|!|\.)+[\s.!?]*$/i;

/** Turns that carry nothing worth learning ("ok", "thanks", empty). */
export function isTrivialMessage(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return true;
  return TRIVIAL_RE.test(t);
}

/** Truncates without splitting a surrogate pair (no lone halves stored). */
export function truncateChars(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
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
  const nonce = getFenceNonce(db);

  const tx = db.transaction(() => {
    for (const input of inputs) {
      const peer = validatePeer(input.peer);
      const session =
        typeof input.session === "string" && input.session.trim() ? input.session.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 128) || "default" : "default";
      const role = (ROLES as readonly string[]).includes(String(input.role)) ? String(input.role) : "user";
      if (typeof input.content !== "string") throw new Error("content must be a string");
      const content = truncateChars(redactSecrets(stripFences(input.content, nonce)).text, 20000);
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
      const source = typeof input.source === "string" && /^[a-z0-9_.:-]{1,32}$/i.test(input.source) ? input.source : "api";
      const res = insert.run(peer, session, role, content, ts, now, status, digest, contentDigest, source);
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
  const nonce = getFenceNonce(db);
  const digest = sha([peer, session, ...rows.map((r) => `${r.role}:${stripFences(r.content, nonce)}`)]);
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

/** Lease after which another worker may take over a claim (a live worker never needs this long). */
export function staleClaimMs(): number {
  const v = Number(process.env.MNEMO_STALE_CLAIM_MS);
  return Number.isFinite(v) && v > 0 ? v : 10 * 60 * 1000;
}

const HOST = hostname();
/** This process's claim owner tag: host:pid:nonce (nonce survives pid reuse). */
export const CLAIM_OWNER = `${HOST}:${process.pid}:${randomBytes(4).toString("hex")}`;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: exists but belongs to someone else.
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/**
 * Releases claims whose owner is gone: any claim older than the lease, and at
 * once any claim held by a process on this host that no longer exists (a
 * SIGKILLed daemon or CLI), so its batch is not stuck for the whole lease.
 */
export function releaseDeadClaims(db: Database, now = Date.now()): number {
  let released = db
    .prepare(`UPDATE messages SET status = 'pending', claimed_at = NULL, claimed_by = NULL WHERE status = 'processing' AND claimed_at < ?`)
    .run(now - staleClaimMs()).changes;
  const owners = db.query(`SELECT DISTINCT claimed_by FROM messages WHERE status = 'processing' AND claimed_by IS NOT NULL`).all() as Array<{
    claimed_by: string;
  }>;
  for (const { claimed_by } of owners) {
    const [host, pid] = claimed_by.split(":");
    if (host !== HOST || claimed_by === CLAIM_OWNER) continue;
    const n = Number(pid);
    if (Number.isInteger(n) && n > 0 && !pidAlive(n)) {
      released += db
        .prepare(`UPDATE messages SET status = 'pending', claimed_at = NULL, claimed_by = NULL WHERE status = 'processing' AND claimed_by = ?`)
        .run(claimed_by).changes;
    }
  }
  return released;
}

/** Claims up to `limit` due messages of the peer with the oldest due message. */
export function claimBatch(db: Database, limit: number, now = Date.now(), owner = CLAIM_OWNER): { peer: string; messages: MessageRow[] } | null {
  let claimed: MessageRow[] = [];
  let peer = "";
  // IMMEDIATE: take the write lock before reading, so two processes (daemon +
  // `mnemo derive`) can never claim the same rows or hit a BUSY lock upgrade.
  db.transaction(() => {
    releaseDeadClaims(db, now);
    const head = db
      .query(`SELECT peer FROM messages WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 1`)
      .get(now) as { peer: string } | null;
    if (!head) return;
    peer = head.peer;
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
    const mark = db.prepare(`UPDATE messages SET status = 'processing', claimed_at = ?, claimed_by = ? WHERE id = ? AND status = 'pending'`);
    claimed = claimed.filter((r) => mark.run(now, owner, r.id).changes > 0);
  }).immediate();
  return claimed.length ? { peer, messages: claimed } : null;
}

/** Marks the batch done. Only rows still claimed by `owner` change (a lease another worker took over is theirs). */
export function completeBatch(db: Database, ids: number[], owner = CLAIM_OWNER): number {
  const stmt = db.prepare(
    `UPDATE messages SET status = 'done', claimed_at = NULL, claimed_by = NULL, last_error = NULL WHERE id = ? AND status = 'processing' AND claimed_by = ?`
  );
  let n = 0;
  db.transaction(() => ids.forEach((id) => (n += stmt.run(id, owner).changes))).immediate();
  return n;
}

/** A batch whose LLM output keeps failing to parse is parked after this many tries (it would otherwise cost money forever). */
export const MAX_POISON_ATTEMPTS = 5;

/**
 * Puts a failed batch back on the queue with capped exponential backoff (offline = just waits).
 * `transient` failures (endpoint down, 429/5xx, auth/config errors) retry forever;
 * content failures (malformed model output) are parked as 'skipped' with a
 * dead-letter note after MAX_POISON_ATTEMPTS so they stop spending tokens.
 */
export function failBatch(db: Database, ids: number[], error: string, now = Date.now(), opts: { transient?: boolean; owner?: string } = {}): { parked: number } {
  const owner = opts.owner ?? CLAIM_OWNER;
  const msg = error.slice(0, 500);
  const retry = db.prepare(`
    UPDATE messages
    SET status = 'pending', claimed_at = NULL, claimed_by = NULL, attempts = attempts + 1, last_error = ?,
        next_attempt_at = ? + MIN(900000, 5000 * (1 << MIN(attempts, 8)))
    WHERE id = ? AND status = 'processing' AND claimed_by = ?
  `);
  const park = db.prepare(`
    UPDATE messages SET status = 'skipped', claimed_at = NULL, claimed_by = NULL, attempts = attempts + 1, last_error = ?
    WHERE id = ? AND attempts + 1 >= ? AND status = 'processing' AND claimed_by = ?
  `);
  let parked = 0;
  db.transaction(() => {
    for (const id of ids) {
      if (!opts.transient && park.run(`dead-letter after ${MAX_POISON_ATTEMPTS} attempts: ${msg}`.slice(0, 500), id, MAX_POISON_ATTEMPTS, owner).changes > 0) {
        parked++;
        continue;
      }
      retry.run(msg, now, id, owner);
    }
  }).immediate();
  return { parked };
}

/** Puts dead-lettered messages back on the queue (after fixing the model/config). */
export function requeueDeadLetters(db: Database, peer?: string): number {
  const sql = `UPDATE messages SET status = 'pending', attempts = 0, next_attempt_at = 0, last_error = NULL
               WHERE status = 'skipped' AND last_error LIKE 'dead-letter%'${peer ? " AND peer = ?" : ""}`;
  return (peer ? db.prepare(sql).run(peer) : db.prepare(sql).run()).changes;
}

export function queueStats(db: Database, now = Date.now()) {
  const rows = db.query(`SELECT status, COUNT(*) AS c FROM messages GROUP BY status`).all() as Array<{ status: string; c: number }>;
  const by = { pending: 0, processing: 0, done: 0, skipped: 0, dead_letter: 0 };
  for (const r of rows) if (r.status in by) by[r.status as keyof typeof by] = r.c;
  by.dead_letter = (db.query(`SELECT COUNT(*) AS c FROM messages WHERE status = 'skipped' AND last_error LIKE 'dead-letter%'`).get() as { c: number }).c;
  const due = (db.query(`SELECT COUNT(*) AS c FROM messages WHERE status = 'pending' AND next_attempt_at <= ?`).get(now) as { c: number }).c;
  const nextRetry = (db.query(`SELECT MIN(next_attempt_at) AS t FROM messages WHERE status = 'pending' AND next_attempt_at > ?`).get(now) as {
    t: number | null;
  }).t;
  return { ...by, due_now: due, next_retry_at: nextRetry };
}
