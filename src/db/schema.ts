import type { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  // SQLite Performance & Concurrency Pragmas
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA cache_size = -2000;
    PRAGMA temp_store = MEMORY;
    PRAGMA mmap_size = 30000000;
    PRAGMA wal_autocheckpoint = 250;
  `);

  // 1. Core Memories Table (with Bi-temporal, Outcome, & Structure Type support)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'project', 'session')),
      category TEXT NOT NULL DEFAULT 'fact',
      importance TEXT NOT NULL DEFAULT 'normal' CHECK(importance IN ('low', 'normal', 'high', 'critical')),
      structure_type TEXT NOT NULL DEFAULT 'freeform' CHECK(structure_type IN ('freeform', 'decision_ledger', 'checklist', 'rule_matrix')),
      tags TEXT NOT NULL DEFAULT '[]',
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      superseded_by_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      valid_from INTEGER NOT NULL DEFAULT 0,
      valid_until INTEGER,
      outcome TEXT NOT NULL DEFAULT 'neutral' CHECK(outcome IN ('success', 'failure', 'neutral')),
      failure_reason TEXT,
      is_negative_constraint INTEGER NOT NULL DEFAULT 0,
      peer TEXT NOT NULL DEFAULT 'user',
      source_session TEXT,
      memory_type TEXT NOT NULL DEFAULT 'declarative' CHECK(memory_type IN ('declarative', 'imperative')),
      contradiction_count INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 1.0,
      fingerprint TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'expired'))
    );
  `);

  // Auto-migrate older memories schema safely if columns are missing
  try {
    const memCols = db.query("PRAGMA table_info(memories)").all().map((c: any) => c.name);
    if (!memCols.includes("valid_from")) {
      db.exec("ALTER TABLE memories ADD COLUMN valid_from INTEGER NOT NULL DEFAULT 0;");
    }
    if (!memCols.includes("valid_until")) {
      db.exec("ALTER TABLE memories ADD COLUMN valid_until INTEGER;");
    }
    if (!memCols.includes("outcome")) {
      db.exec("ALTER TABLE memories ADD COLUMN outcome TEXT NOT NULL DEFAULT 'neutral';");
    }
    if (!memCols.includes("failure_reason")) {
      db.exec("ALTER TABLE memories ADD COLUMN failure_reason TEXT;");
    }
    if (!memCols.includes("is_negative_constraint")) {
      db.exec("ALTER TABLE memories ADD COLUMN is_negative_constraint INTEGER NOT NULL DEFAULT 0;");
    }
    if (!memCols.includes("structure_type")) {
      db.exec("ALTER TABLE memories ADD COLUMN structure_type TEXT NOT NULL DEFAULT 'freeform';");
    }
    if (!memCols.includes("peer")) {
      db.exec("ALTER TABLE memories ADD COLUMN peer TEXT NOT NULL DEFAULT 'user';");
    }
    if (!memCols.includes("source_session")) {
      db.exec("ALTER TABLE memories ADD COLUMN source_session TEXT;");
    }
    if (!memCols.includes("memory_type")) {
      db.exec("ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'declarative';");
    }
    if (!memCols.includes("contradiction_count")) {
      db.exec("ALTER TABLE memories ADD COLUMN contradiction_count INTEGER NOT NULL DEFAULT 0;");
    }
    if (!memCols.includes("confidence")) {
      db.exec("ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;");
    }
    if (!memCols.includes("fingerprint")) {
      db.exec("ALTER TABLE memories ADD COLUMN fingerprint TEXT;");
    }
    if (!memCols.includes("status")) {
      db.exec("ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active';");
    }
  } catch {
    // Ignore migration checks if fresh
  }

  // Create indexes after columns are guaranteed to exist
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_scope_active ON memories(scope, is_active);
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed_at);
    CREATE INDEX IF NOT EXISTS idx_memories_validity ON memories(valid_from, valid_until);
    CREATE INDEX IF NOT EXISTS idx_memories_negative ON memories(is_negative_constraint);
    CREATE INDEX IF NOT EXISTS idx_memories_structure ON memories(structure_type);
    CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_session, peer);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
    CREATE INDEX IF NOT EXISTS idx_memories_fingerprint ON memories(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
  `);

  // 2. Vector Embeddings Table (stores raw Float32Array bytes as BLOB)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors (
      memory_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      dimension INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
  `);

  // 3. SQLite FTS5 Full-Text Search Table (Lexical Search)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      memory_id UNINDEXED,
      content,
      category,
      tags,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  // 4. Entity Triples Graph Table (Mem0 + Zep Temporal Edge style)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_triples (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      memory_id TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      is_active INTEGER NOT NULL DEFAULT 1,
      valid_from INTEGER NOT NULL DEFAULT 0,
      valid_until INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
  `);

  try {
    const tripleCols = db.query("PRAGMA table_info(entity_triples)").all().map((c: any) => c.name);
    if (!tripleCols.includes("valid_from")) {
      db.exec("ALTER TABLE entity_triples ADD COLUMN valid_from INTEGER NOT NULL DEFAULT 0;");
    }
    if (!tripleCols.includes("valid_until")) {
      db.exec("ALTER TABLE entity_triples ADD COLUMN valid_until INTEGER;");
    }
  } catch {
    // Ignore
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_triples_spo ON entity_triples(subject, predicate, object);
    CREATE INDEX IF NOT EXISTS idx_triples_active ON entity_triples(is_active);
  `);

  // 5. Entity Resolution & Canonical Aliases (Cognee style)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_aliases (
      alias TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_aliases_canonical ON entity_aliases(canonical_name);
  `);

  // 6. Associative Resonance Links (Holographic Memory style)
  db.exec(`
    CREATE TABLE IF NOT EXISTS associative_links (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      resonance_weight REAL NOT NULL DEFAULT 0.5,
      co_occurrences INTEGER NOT NULL DEFAULT 1,
      last_linked_at INTEGER NOT NULL,
      PRIMARY KEY (source_id, target_id),
      FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_assoc_source ON associative_links(source_id, resonance_weight);
  `);

  // 7. Personas & Theory of Mind Table (Honcho style)
  db.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('user', 'agent')),
      name TEXT NOT NULL,
      worldview TEXT NOT NULL DEFAULT '',
      hard_constraints TEXT NOT NULL DEFAULT '[]',
      preferences TEXT NOT NULL DEFAULT '{}',
      working_style TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);

  // 8. Remediation Playbooks Table (Reflexion & Self-Healing Agent Architecture)
  db.exec(`
    CREATE TABLE IF NOT EXISTS remediations (
      id TEXT PRIMARY KEY,
      trigger_pattern TEXT NOT NULL,
      problem_summary TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      fix_steps TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'global',
      success_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_remediations_trigger ON remediations(trigger_pattern);
  `);

  // 9. Higher-Order Reflections Table (Stanford Generative Agents & A-MEM)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reflections (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      abstraction TEXT NOT NULL,
      source_memory_ids TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'global',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reflections_topic ON reflections(topic);
  `);

  // 10. Immutable Event Ledger Table (Mem0 Jan 2026 SOTA)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_events (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('CREATED', 'MUTATED', 'SUPERSEDED', 'PURGED')),
      payload TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'user',
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_memory ON memory_events(memory_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_type ON memory_events(event_type);
  `);

  // 11. Audit Log & Cryptographic Deletion Receipts (SHA-256 tamper-proof audit proof)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      target_id TEXT NOT NULL,
      sha256_hash TEXT NOT NULL,
      evidence TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_id);
  `);

  // 12. Execution Trajectories & Tool Calibration Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS trajectories (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      tool_name TEXT NOT NULL DEFAULT 'shell',
      failed_command TEXT,
      error_snippet TEXT,
      fixed_command TEXT NOT NULL,
      success_output_snippet TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      success_count INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trajectories_goal ON trajectories(goal);
    CREATE INDEX IF NOT EXISTS idx_trajectories_tool ON trajectories(tool_name);
  `);

  // 13. Git-Anchored Codebase Memories Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_git_anchors (
      memory_id TEXT PRIMARY KEY,
      repo_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      commit_hash TEXT NOT NULL,
      file_mtime INTEGER NOT NULL,
      file_hash TEXT,
      status TEXT NOT NULL DEFAULT 'fresh' CHECK(status IN ('fresh', 'stale', 'unlinked')),
      last_verified_at INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_git_anchors_status ON memory_git_anchors(status);
    CREATE INDEX IF NOT EXISTS idx_git_anchors_file ON memory_git_anchors(file_path);
  `);

  // 14. Multi-Agent Epistemic Blackboard Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS blackboard_entries (
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      state_type TEXT NOT NULL DEFAULT 'verified_fact' CHECK(state_type IN ('hypothesis', 'verified_fact', 'in_progress', 'artifact', 'blocker')),
      author_agent_id TEXT NOT NULL DEFAULT 'main',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_blackboard_session ON blackboard_entries(session_id, updated_at);
  `);

  // 15. Hermes Raw History & Ingested Notes (Slow Path Layer 3)
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer TEXT NOT NULL DEFAULT 'user',
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id, id);
    CREATE INDEX IF NOT EXISTS idx_notes_timestamp ON notes(timestamp);
  `);

  // 16. Hermes Behavior & Preference Patterns
  db.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      peer TEXT NOT NULL DEFAULT 'user',
      pattern TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'preference' CHECK(type IN ('behavior', 'preference', 'workflow')),
      confidence REAL NOT NULL DEFAULT 0.8,
      sources TEXT NOT NULL DEFAULT '[]',
      timestamp INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_patterns_peer ON patterns(peer);
    CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(type);
  `);

  // 17. Hermes Reflection & Dreams Ledger (Idempotent Delta Audits)
  db.exec(`
    CREATE TABLE IF NOT EXISTS dreams (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      input_delta_count INTEGER NOT NULL DEFAULT 0,
      output_json TEXT NOT NULL DEFAULT '{}',
      facts_added INTEGER NOT NULL DEFAULT 0,
      facts_superseded INTEGER NOT NULL DEFAULT 0,
      patterns_found INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dreams_timestamp ON dreams(timestamp);
  `);

  // 18. Hermes Checkpoints & Watermark Meta (Last Dreamed ID & State)
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // 19. Transparent Facts View (Hermes Layer 2)
  db.exec(`
    CREATE VIEW IF NOT EXISTS facts AS 
    SELECT 
      id,
      peer,
      content AS fact,
      memory_type AS type,
      source_session,
      created_at AS timestamp,
      confidence,
      valid_until AS ttl,
      status,
      fingerprint
    FROM memories;
  `);
}
