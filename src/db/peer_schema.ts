import type { Database } from "bun:sqlite";

/**
 * Personal-memory ("peer") layer: raw conversation messages, the derivation
 * queue, derived facts with provenance + trust, peer representations and
 * per-session summaries. Additive only — no existing table is altered.
 */
export function initPeerSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer TEXT NOT NULL,
      session TEXT NOT NULL DEFAULT 'default',
      role TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL,
      ts INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'skipped')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      claimed_at INTEGER,
      last_error TEXT,
      digest TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'api'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_digest ON messages(digest);
    CREATE INDEX IF NOT EXISTS idx_messages_content_digest ON messages(content_digest);
    CREATE INDEX IF NOT EXISTS idx_messages_queue ON messages(status, next_attempt_at, peer);
    CREATE INDEX IF NOT EXISTS idx_messages_peer_session ON messages(peer, session, id);

    CREATE TABLE IF NOT EXISTS derived_facts (
      memory_id TEXT PRIMARY KEY,
      peer TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'explicit' CHECK(kind IN ('explicit', 'deductive', 'conclusion', 'insight', 'manual')),
      category TEXT NOT NULL DEFAULT 'profile' CHECK(category IN ('profile', 'preferences', 'entities', 'events', 'cases', 'patterns')),
      trust REAL NOT NULL DEFAULT 0.5,
      observations INTEGER NOT NULL DEFAULT 1,
      source_message_ids TEXT NOT NULL DEFAULT '[]',
      source_memory_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_derived_peer ON derived_facts(peer, category);

    CREATE TABLE IF NOT EXISTS peer_representations (
      peer TEXT PRIMARY KEY,
      summary TEXT NOT NULL DEFAULT '',
      card TEXT NOT NULL DEFAULT '[]',
      pinned_card TEXT,
      fact_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'deterministic',
      facts_since_reflect INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_summaries (
      peer TEXT NOT NULL,
      session TEXT NOT NULL,
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (peer, session)
    );

    CREATE TABLE IF NOT EXISTS peer_checkpoints (
      digest TEXT PRIMARY KEY,
      peer TEXT NOT NULL,
      session TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      queued INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}
