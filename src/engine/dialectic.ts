import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import { CONFIG } from "../config.ts";
import type { 
  ConsolidationReport, EntityAlias, EntityTriple, PersonaProfile, 
  RememberOptions, FactInput, UpsertFactResult, DeleteBySourceOptions, DeleteBySourceResult,
  IngestOptions, IngestResult, HermesStats
} from "../types.ts";
import { getEmbedding, cosineSimilarity, decodeVector } from "./embedder.ts";
import { recordMemoryEvent } from "./doctor.ts";

/**
 * Normalized string hash fingerprint for instant zero-LLM deduplication
 */
export function computeFingerprint(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .sort()
    .join(" ");
  return Bun.hash(normalized).toString(16);
}

/**
 * Filter noise: detect transactional/ephemeral messages (task progress, build steps)
 */
export function isTransactionalNoise(text: string, category?: string): boolean {
  if (category === "episodic" || category === "session" || category === "task_progress") return true;
  const lower = text.toLowerCase().trim();
  if (
    /^(done|ok|sip|siap|sedang mengerjakan|working on|in progress|step \d|running command|exit code \d|stdout:|stderr:)/i.test(lower) ||
    /\b(running test|npm install|bun install|git commit|git push|building project|task completed|task in progress|build finished|opennextjs-cloudflare)\b/i.test(lower)
  ) {
    return true;
  }
  return false;
}

export const OPPOSITES: Record<string, string> = {
  LIKES: "DISLIKES",
  DISLIKES: "LIKES",
  SUKA: "BENCI",
  BENCI: "SUKA",
  LOVES: "HATES",
  HATES: "LOVES",
  WANTS: "REJECTS",
  REJECTS: "WANTS",
  ENABLES: "DISABLES",
  DISABLES: "ENABLES",
  ALLOWS: "FORBIDS",
  FORBIDS: "ALLOWS",
  TRUE: "FALSE",
  FALSE: "TRUE",
};

/**
 * Tuned rule-based triple extractor: (Subject)-[Predicate]->(Object)
 * Highly optimized for Indonesian and English developer statements.
 */
export function extractTriples(text: string): Array<{ subject: string; predicate: string; object: string }> {
  const triples: Array<{ subject: string; predicate: string; object: string }> = [];
  const normalized = text.trim();

  // Pattern A: Port listeners: e.g. "Albatross berjalan di Bun port 8787" or "server listens on 8788"
  const portMatch = normalized.match(/([A-Za-z0-9_\-\.\s]+?)\s+(?:berjalan di|listens on|running on|menggunakan port|port)\s+(?:port\s+)?(\d{2,5})/i);
  if (portMatch) {
    triples.push({
      subject: portMatch[1].trim(),
      predicate: "LISTENS_ON_PORT",
      object: portMatch[2].trim(),
    });
  }

  // Pattern B: Declarative verbs (EN + ID)
  const verbRegex = /([A-Za-z0-9_\-\.\s]+?)\s+(prefers?|likes?|dislikes?|loves?|hates?|uses?|requires?|needs?|builds with|deploys via|deploys to|runs on|is constrained by|suka|benci|tidak suka|gemar|memerlukan|menggunakan|memakai|berjalan di|mendeploy ke|menyimpan data di)\s+([A-Za-z0-9_\-\.\s]+)/i;
  const match = normalized.match(verbRegex);
  if (match) {
    const subject = match[1].trim();
    const raw_predicate = match[2].trim();
    let predicate = raw_predicate.toUpperCase().replace(/\s+/g, "_");
    
    // Normalize Indonesian & synonym predicates to canonical English predicates
    if (predicate === "PREFER" || predicate === "PREFERS") predicate = "PREFERS";
    else if (predicate === "LIKE" || predicate === "LIKES" || predicate === "SUKA" || predicate === "GEMAR" || predicate === "LOVES" || predicate === "LOVE") predicate = "LIKES";
    else if (predicate === "DISLIKE" || predicate === "DISLIKES" || predicate === "BENCI" || predicate === "TIDAK_SUKA" || predicate === "HATE" || predicate === "HATES") predicate = "DISLIKES";
    else if (predicate === "USE" || predicate === "USES" || predicate === "MENGGUNAKAN" || predicate === "MEMAKAI") predicate = "USES";
    else if (predicate === "BERJALAN_DI") predicate = "RUNS_ON";
    else if (predicate === "MENDEPLOY_KE") predicate = "DEPLOYS_TO";
    else if (predicate === "REQUIRE" || predicate === "REQUIRES" || predicate === "MEMERLUKAN") predicate = "REQUIRES";
    else if (predicate === "NEED" || predicate === "NEEDS") predicate = "NEEDS";
    else if (predicate === "MENYIMPAN_DATA_DI") predicate = "STORES_DATA_IN";

    const object = match[3].trim().replace(/[.,;]$/, "");
    if (subject && predicate && object) {
      triples.push({ subject, predicate, object, raw_predicate });
    }
  }

  // Pattern C: Safety guardrails & constraints
  if (
    /ram\s+\d+gb/i.test(normalized) ||
    /jangan\s+(pernah\s+)?build/i.test(normalized) ||
    /dilarang/i.test(normalized) ||
    /never\s+run/i.test(normalized)
  ) {
    triples.push({
      subject: "SafetyGuardrail",
      predicate: "FORBIDS",
      object: normalized.slice(0, 100),
    });
  }

  // Pattern D: Alias & Acronym Auto-Canonicalization
  // e.g. "gw alias albatross-gateway", "gw aka albatross-gateway", "albatross-gateway (gw)"
  const aliasMatch = normalized.match(/([A-Za-z0-9_\-]+)\s+(?:alias|aka|known as|disebut juga|is alias of)\s+([A-Za-z0-9_\-]+)/i);
  if (aliasMatch) {
    triples.push({
      subject: aliasMatch[1].trim().toLowerCase(),
      predicate: "ALIAS_OF",
      object: aliasMatch[2].trim(),
    });
  } else {
    const parenMatch = normalized.match(/([A-Za-z0-9_\-]+)\s*\(([A-Za-z0-9_\-]+)\)/i);
    if (parenMatch) {
      triples.push({
        subject: parenMatch[2].trim().toLowerCase(),
        predicate: "ALIAS_OF",
        object: parenMatch[1].trim(),
      });
    }
  }

  return triples;
}

/**
 * Ingests a new memory record into the system with bi-temporal and guardrail awareness.
 */
export async function rememberMemory(
  db: Database,
  options: RememberOptions
): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const content = options.content.trim();
  const scope = options.scope || "global";
  const category = options.category || "fact";
  const importance = options.importance || "normal";
  const tags = options.tags || [];

  // Auto-detect Negative Constraints & Anti-patterns (Supermemory style)
  const isNegative =
    options.is_negative_constraint !== undefined
      ? options.is_negative_constraint
      : category === "negative_constraint" ||
        /\b(jangan|dilarang|never|must not|do not|anti-pattern|tidak boleh)\b/i.test(content);

  // Auto-detect Outcome / Reflection (LangMem style)
  let outcome = options.outcome || "neutral";
  let failureReason = options.failure_reason || null;
  if (!options.outcome && /\b(gagal|error|failed|crash|hang|401 unauthorized)\b/i.test(content)) {
    outcome = "failure";
    if (!failureReason) failureReason = content;
  }

  const validFrom = options.valid_from !== undefined ? options.valid_from : now;
  const validUntil = options.valid_until !== undefined ? options.valid_until : null;

  // 1. Conflict Invalidation via explicit query (Mem0 style):
  if (options.supersedes_query) {
    const candidates = db
      .query(`SELECT id FROM memories WHERE is_active = 1 AND content LIKE ?`)
      .all(`%${options.supersedes_query}%`) as any[];

    for (const c of candidates) {
      db.prepare(
        `UPDATE memories SET is_active = 0, status = 'superseded', superseded_by_id = ?, updated_at = ? WHERE id = ?`
      ).run(id, now, c.id);
      recordMemoryEvent(db, c.id, "SUPERSEDED", `Superseded by memory ${id}`, options.actor || "user");
    }
  }

  const fingerprint = computeFingerprint(content);
  const structureType = options.structure_type || "freeform";
  const peer = options.peer || "user";
  const sourceSession = options.source_session || null;
  const memoryType = options.memory_type || (isNegative || options.category === "rule" || options.category === "negative_constraint" ? "imperative" : "declarative");
  const confidence = options.confidence !== undefined ? options.confidence : 1.0;

  // Fast-Path Hash Fingerprint Deduplication (0 MB RAM, Instant Zero-LLM Reinforcement)
  if (!options.supersedes_query) {
    const fpMatch = db.query(`
      SELECT id, access_count, confidence, tags FROM memories 
      WHERE is_active = 1 AND fingerprint = ? AND (peer = ? OR peer = 'user')
    `).get(fingerprint, peer) as any;

    if (fpMatch) {
      let existingTags: string[] = [];
      try {
        existingTags = typeof fpMatch.tags === "string" ? JSON.parse(fpMatch.tags) : (fpMatch.tags || []);
      } catch {}

      const mergedTags = Array.from(new Set([...existingTags, ...tags]));
      const updatedCount = (fpMatch.access_count || 0) + 1;
      const newConf = Math.min(1.0, (fpMatch.confidence || 1.0) + 0.05);

      db.prepare(`
        UPDATE memories 
        SET access_count = ?, last_accessed_at = ?, updated_at = ?, confidence = ?, tags = ?
        WHERE id = ?
      `).run(updatedCount, now, now, newConf, JSON.stringify(mergedTags), fpMatch.id);

      recordMemoryEvent(
        db,
        fpMatch.id,
        "MUTATED",
        `Reinforced memory via semantic deduplication (fast-path hash fingerprint, confidence: ${newConf.toFixed(2)})`,
        options.actor || peer
      );

      return fpMatch.id;
    }
  }

  // 2. Pre-compute Vector Embedding
  const vector = await getEmbedding(content);

  // 3. Semantic Deduplication & Reinforcement (Anti-Bloat & Truth Strengthening)
  if (!options.supersedes_query) {
    try {
      const activeRows = db.query(`
        SELECT m.id, m.content, m.access_count, m.tags, v.vector 
        FROM memories m
        JOIN memory_vectors v ON m.id = v.memory_id
        WHERE m.is_active = 1 
          AND (m.scope = ? OR m.scope = 'global')
          AND m.category = ?
      `).all(scope, category) as Array<{ id: string; content: string; access_count: number; tags: string; vector: any }>;

      let highestSim = 0;
      let bestMatch: { id: string; content: string; access_count: number; tags: string } | null = null;

      for (const row of activeRows) {
        if (row.content.trim().toLowerCase() === content.toLowerCase()) {
          highestSim = 1.0;
          bestMatch = row;
          break;
        }

        const rowVec = decodeVector(row.vector);
        if (rowVec) {
          const sim = cosineSimilarity(vector, rowVec);
          if (sim > highestSim) {
            highestSim = sim;
            bestMatch = row;
          }
        }
      }

      // If semantic similarity is >= 0.92, reinforce existing memory instead of creating redundant row
      if (highestSim >= 0.92 && bestMatch) {
        let existingTags: string[] = [];
        try {
          existingTags = typeof bestMatch.tags === "string" ? JSON.parse(bestMatch.tags) : (bestMatch.tags || []);
        } catch {}

        const mergedTags = Array.from(new Set([...existingTags, ...tags]));
        const updatedCount = (bestMatch.access_count || 0) + 1;

        db.prepare(`
          UPDATE memories 
          SET access_count = ?, last_accessed_at = ?, updated_at = ?, tags = ?
          WHERE id = ?
        `).run(updatedCount, now, now, JSON.stringify(mergedTags), bestMatch.id);

        recordMemoryEvent(
          db,
          bestMatch.id,
          "MUTATED",
          `Reinforced memory via semantic deduplication (${(highestSim * 100).toFixed(1)}% match)`,
          options.actor || "user"
        );

        return bestMatch.id;
      }
    } catch (err: any) {
      console.warn("Semantic deduplication check skipped:", err.message);
    }
  }

  // 4. Insert into memories table
  db.prepare(`
    INSERT INTO memories (
      id, content, scope, category, importance, structure_type, tags,
      access_count, last_accessed_at, created_at, updated_at,
      superseded_by_id, is_active,
      valid_from, valid_until, outcome, failure_reason, is_negative_constraint,
      peer, source_session, memory_type, contradiction_count,
      confidence, fingerprint, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'active')
  `).run(
    id,
    content,
    scope,
    category,
    importance,
    structureType,
    JSON.stringify(tags),
    now,
    now,
    now,
    validFrom,
    validUntil,
    outcome,
    failureReason,
    isNegative ? 1 : 0,
    peer,
    sourceSession,
    memoryType,
    confidence,
    fingerprint
  );

  // Record creation event in immutable ledger (Mem0 2026 style)
  recordMemoryEvent(db, id, "CREATED", content, options.actor || "user");

  // Layer 3 (Notes): Append to notes raw history so delta dreamer sees all inputs
  if (!options.skip_note_log) {
    try {
      db.prepare(`
        INSERT INTO notes (peer, session_id, role, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(peer, sourceSession, options.actor || "user", content, now);
    } catch {}
  }

  // 5. Store vector embedding
  const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  db.prepare(`
    INSERT OR REPLACE INTO memory_vectors (memory_id, vector, dimension)
    VALUES (?, ?, ?)
  `).run(id, buffer, vector.length);

  // 4. Index into FTS5 virtual table
  try {
    db.prepare(`
      INSERT INTO memory_fts (memory_id, content, category, tags)
      VALUES (?, ?, ?, ?)
    `).run(id, content, category, tags.join(" "));
  } catch {
    // ignore
  }

  // 5. Ingest Triples & Automatic Conflict Resolution for Triples
  const extracted = options.entities || extractTriples(content);
  for (const t of extracted) {
    const subject = t.subject.trim();
    let predicate = t.predicate.trim().toUpperCase().replace(/\s+/g, "_");
    const object = t.object.trim();

    // A. Honcho Self-Healing Conflict Resolution (Antonym / Polarity Check)
    const oppositePred = OPPOSITES[predicate];
    if (oppositePred) {
      const opposing = db
        .query(
          `SELECT t.id, t.memory_id, m.contradiction_count
           FROM entity_triples t
           JOIN memories m ON t.memory_id = m.id
           WHERE LOWER(t.subject) = LOWER(?)
             AND t.predicate = ?
             AND LOWER(t.object) = LOWER(?)
             AND t.is_active = 1`
        )
        .all(subject, oppositePred, object) as any[];

      for (const opp of opposing) {
        db.prepare(`UPDATE entity_triples SET is_active = 0, valid_until = ? WHERE id = ?`).run(now, opp.id);
        if (opp.memory_id && opp.memory_id !== id) {
          const newContradictionCount = (opp.contradiction_count || 0) + 1;
          db.prepare(
            `UPDATE memories SET is_active = 0, status = 'superseded', contradiction_count = ?, superseded_by_id = ?, updated_at = ? WHERE id = ?`
          ).run(newContradictionCount, id, now, opp.memory_id);

          recordMemoryEvent(
            db,
            opp.memory_id,
            "SUPERSEDED",
            `Conflict resolved by recency: '${content}' superseded opposing fact '${oppositePred}'`,
            options.actor || peer
          );
        }
      }
    }

    // B. Dedup by Subject + Predicate: check existing active triple
    const existing = db
      .query(
        `SELECT id, memory_id, object FROM entity_triples
         WHERE LOWER(subject) = LOWER(?) AND predicate = ? AND is_active = 1`
      )
      .all(subject, predicate) as any[];

    for (const old of existing) {
      db.prepare(`UPDATE entity_triples SET is_active = 0, valid_until = ? WHERE id = ?`).run(now, old.id);
      // Also mark older parent memory superseded if not already
      if (old.memory_id && old.memory_id !== id) {
        db.prepare(
          `UPDATE memories SET is_active = 0, status = 'superseded', superseded_by_id = ?, updated_at = ? WHERE id = ?`
        ).run(id, now, old.memory_id);

        recordMemoryEvent(
          db,
          old.memory_id,
          "SUPERSEDED",
          `Fact updated/superseded by memory ${id}`,
          options.actor || peer
        );
      }
    }

    const tripleId = randomUUID();
    db.prepare(`
      INSERT INTO entity_triples (id, subject, predicate, object, memory_id, confidence, is_active, valid_from, valid_until, created_at)
      VALUES (?, ?, ?, ?, ?, 1.0, 1, ?, ?, ?)
    `).run(tripleId, subject, predicate, object, id, validFrom, validUntil, now);

    // Auto-canonicalize: register alias automatically
    if (predicate === "ALIAS_OF" || predicate === "ALIAS") {
      addEntityAlias(db, subject, object);
    }
  }

  return id;
}

/**
 * Entity Resolution & Canonical Aliasing (Cognee style)
 */
export function addEntityAlias(db: Database, alias: string, canonicalName: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO entity_aliases (alias, canonical_name, created_at)
    VALUES (?, ?, ?)
  `).run(alias.toLowerCase().trim(), canonicalName.trim(), Date.now());
}

export function getEntityAliases(db: Database): EntityAlias[] {
  return db.query("SELECT * FROM entity_aliases ORDER BY canonical_name ASC").all() as EntityAlias[];
}

/**
 * Theory-of-Mind: User/Agent Profile Management (Honcho style)
 */
export function getOrCreatePersona(
  db: Database,
  entityType: "user" | "agent",
  name: string = "default"
): PersonaProfile {
  const row = db
    .query(`SELECT * FROM personas WHERE entity_type = ? AND name = ?`)
    .get(entityType, name) as any;

  if (row) {
    return {
      id: row.id,
      entity_type: row.entity_type,
      name: row.name,
      worldview: row.worldview,
      hard_constraints: JSON.parse(row.hard_constraints || "[]"),
      preferences: JSON.parse(row.preferences || "{}"),
      working_style: row.working_style,
      updated_at: row.updated_at,
    };
  }

  const id = randomUUID();
  const now = Date.now();
  const defaultConstraints = [
    "Laptop RAM 16GB: Never run heavy parallel builds (next/opennext/wrangler).",
    "One command at a time, always foreground. No background build tasks.",
    "Database files (*.db, *.db-wal, *.db-shm) must NEVER enter git.",
  ];

  db.prepare(`
    INSERT INTO personas (id, entity_type, name, worldview, hard_constraints, preferences, working_style, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    entityType,
    name,
    "Values local-first, lightweight architecture, high performance, and clean ergonomics.",
    JSON.stringify(defaultConstraints),
    JSON.stringify({ runtime: "bun", language: "typescript", database: "sqlite-wal" }),
    "Concise, production-grade, github markdown, actionable instructions.",
    now
  );

  return {
    id,
    entity_type: entityType,
    name,
    worldview: "Values local-first, lightweight architecture, high performance, and clean ergonomics.",
    hard_constraints: defaultConstraints,
    preferences: { runtime: "bun", language: "typescript", database: "sqlite-wal" },
    working_style: "Concise, production-grade, github markdown, actionable instructions.",
    updated_at: now,
  };
}

/**
 * Memory Consolidation & Pruning Engine (MemGPT sleep cycle / heartbeat)
 */
export function consolidateMemories(db: Database): ConsolidationReport {
  const now = Date.now();

  // 1. Deactivate expired temporal memories
  const expiredRes = db
    .prepare(`UPDATE memories SET is_active = 0 WHERE is_active = 1 AND valid_until IS NOT NULL AND valid_until < ?`)
    .run(now);

  // 2. Count superseded memories cleaned
  const supersededRow = db
    .query(`SELECT COUNT(*) as count FROM memories WHERE is_active = 0 AND superseded_by_id IS NOT NULL`)
    .get() as any;

  // 3. Strengthen associative links
  const linksRes = db
    .prepare(`UPDATE associative_links SET resonance_weight = MIN(0.95, resonance_weight + 0.02) WHERE co_occurrences > 2`)
    .run();

  // 4. Count remaining active memories
  const activeRow = db.query(`SELECT COUNT(*) as count FROM memories WHERE is_active = 1`).get() as any;

  return {
    pruned_memories: expiredRes.changes,
    superseded_cleaned: supersededRow?.count || 0,
    links_strengthened: linksRes.changes,
    active_memories_remaining: activeRow?.count || 0,
  };
}

/**
 * Upsert Fact with Entity + Predicate Dedup & Honcho Self-Healing Conflict Resolution
 * Prevents duplicate rows when the same fact is repeated, and self-heals contradictions.
 */
export async function upsertFact(
  db: Database,
  fact: FactInput
): Promise<UpsertFactResult> {
  const subject = fact.subject.trim();
  const rawPred = fact.raw_predicate || fact.predicate;
  let predicate = fact.predicate.trim().toUpperCase().replace(/\s+/g, "_");

  // Normalize Indonesian verbs to canonical predicates
  if (predicate === "MENGGUNAKAN" || predicate === "MEMAKAI") predicate = "USES";
  else if (predicate === "SUKA") predicate = "LIKES";
  else if (predicate === "BENCI") predicate = "DISLIKES";

  const object = fact.object.trim();
  const scope = fact.scope || "global";
  const category = fact.category || (predicate === "LIKES" || predicate === "DISLIKES" ? "preference" : "fact");
  const peer = fact.peer || "user";
  const sourceSession = fact.source_session || null;
  const importance = fact.importance || (predicate === "LIKES" ? "high" : "normal");
  const now = Date.now();

  const formattedContent = fact.content?.trim() || 
    (fact.raw_predicate 
      ? `${subject} ${fact.raw_predicate.toLowerCase()} ${object}`
      : `${subject} ${predicate.toLowerCase()} ${object}`);

  // 1. Honcho Self-Healing Conflict Resolution (Antonym / Polarity Check)
  const oppositePred = OPPOSITES[predicate];
  if (oppositePred) {
    const conflicting = db.query(`
      SELECT t.id as triple_id, t.memory_id, m.contradiction_count
      FROM entity_triples t
      JOIN memories m ON t.memory_id = m.id
      WHERE LOWER(t.subject) = LOWER(?)
        AND t.predicate = ?
        AND LOWER(t.object) = LOWER(?)
        AND t.is_active = 1
    `).get(subject, oppositePred, object) as any;

    if (conflicting) {
      // Contradiction detected! Resolution by recency: newer fact supersedes older fact.
      const newMemoryId = randomUUID();
      const newTripleId = randomUUID();
      const content = formattedContent;

      db.query(`UPDATE entity_triples SET is_active = 0, valid_until = ? WHERE id = ?`)
        .run(now, conflicting.triple_id);

      const contradictionCount = (conflicting.contradiction_count || 0) + 1;
      db.query(`
        UPDATE memories 
        SET is_active = 0, contradiction_count = ?, superseded_by_id = ?, updated_at = ? 
        WHERE id = ?
      `).run(contradictionCount, newMemoryId, now, conflicting.memory_id);

      recordMemoryEvent(
        db,
        conflicting.memory_id,
        "SUPERSEDED",
        `Conflict resolved by recency: '${content}' superseded opposing fact '${oppositePred}'`,
        peer
      );

      // Insert fresh winning memory
      await rememberMemory(db, {
        content,
        scope,
        category,
        importance,
        peer,
        source_session: sourceSession,
        entities: [{ subject, predicate, object }],
        skip_note_log: true,
      });

      return {
        action: "superseded",
        fact_id: newTripleId,
        memory_id: newMemoryId,
        subject,
        predicate,
        object,
        contradiction_resolved: true,
      };
    }
  }

  // 2. Dedup by Entity + Predicate: check existing active fact
  const existing = db.query(`
    SELECT t.id as triple_id, t.memory_id, t.object, m.access_count
    FROM entity_triples t
    JOIN memories m ON t.memory_id = m.id
    WHERE LOWER(t.subject) = LOWER(?)
      AND t.predicate = ?
      AND t.is_active = 1
  `).get(subject, predicate) as any;

  if (existing) {
    // Case A: Identical fact (e.g. 5x bilang "dek suka americano")
    if (existing.object.toLowerCase() === object.toLowerCase()) {
      const updatedCount = (existing.access_count || 0) + 1;
      db.query(`
        UPDATE memories 
        SET access_count = ?, last_accessed_at = ?, updated_at = ? 
        WHERE id = ?
      `).run(updatedCount, now, now, existing.memory_id);

      recordMemoryEvent(
        db,
        existing.memory_id,
        "MUTATED",
        `Reinforced standing fact: ${subject} ${predicate} ${object}`,
        peer
      );

      return {
        action: "reinforced",
        fact_id: existing.triple_id,
        memory_id: existing.memory_id,
        subject,
        predicate,
        object,
      };
    }

    // Case B: Value update (e.g. "dek suka americano" -> "dek suka latte")
    const newMemoryId = randomUUID();
    const newTripleId = randomUUID();
    const content = formattedContent;

    db.query(`UPDATE entity_triples SET is_active = 0, valid_until = ? WHERE id = ?`)
      .run(now, existing.triple_id);

    db.query(`
      UPDATE memories 
      SET is_active = 0, superseded_by_id = ?, updated_at = ? 
      WHERE id = ?
    `).run(newMemoryId, now, existing.memory_id);

    recordMemoryEvent(
      db,
      existing.memory_id,
      "SUPERSEDED",
      `Fact updated: '${existing.object}' -> '${object}'`,
      peer
    );

    await rememberMemory(db, {
      content,
      scope,
      category,
      importance,
      peer,
      source_session: sourceSession,
      entities: [{ subject, predicate, object }],
      skip_note_log: true,
    });

    return {
      action: "updated",
      fact_id: newTripleId,
      memory_id: newMemoryId,
      subject,
      predicate,
      object,
      previous_object: existing.object,
    };
  }

  // 3. Brand new fact -> Insert
  const content = formattedContent;
  const memId = await rememberMemory(db, {
    content,
    scope,
    category,
    importance,
    peer,
    source_session: sourceSession,
    entities: [{ subject, predicate, object }],
    skip_note_log: true,
  });

  const triple = db.query(`
    SELECT id FROM entity_triples WHERE memory_id = ? AND is_active = 1
  `).get(memId) as any;

  return {
    action: "inserted",
    fact_id: triple?.id || randomUUID(),
    memory_id: memId,
    subject,
    predicate,
    object,
  };
}

/**
 * Extract facts from text or statements and upsert them with dedup
 */
export async function extractAndUpsert(
  db: Database,
  text: string,
  options: Partial<FactInput> = {}
): Promise<UpsertFactResult[]> {
  const triples = extractTriples(text);
  const results: UpsertFactResult[] = [];

  for (const t of triples) {
    const res = await upsertFact(db, {
      subject: t.subject,
      predicate: t.predicate,
      raw_predicate: t.raw_predicate,
      object: t.object,
      content: text,
      ...options,
    });
    results.push(res);
  }

  return results;
}

/**
 * Delete / Purge memories and triples by provenance metadata (peer, session, type)
 */
export function deleteBySource(
  db: Database,
  options: DeleteBySourceOptions
): DeleteBySourceResult {
  const conditions: string[] = ["is_active = 1"];
  const params: any[] = [];

  if (options.source_session) {
    conditions.push("source_session = ?");
    params.push(options.source_session);
  }
  if (options.peer) {
    conditions.push("peer = ?");
    params.push(options.peer);
  }
  if (options.memory_type) {
    conditions.push("memory_type = ?");
    params.push(options.memory_type);
  }
  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }

  if (params.length === 0) {
    return { memories_deleted: 0, triples_deleted: 0, affected_ids: [] };
  }

  const matching = db.query(`SELECT id FROM memories WHERE ${conditions.join(" AND ")}`).all(...params) as Array<{ id: string }>;
  const ids = matching.map((m) => m.id);
  if (ids.length === 0) {
    return { memories_deleted: 0, triples_deleted: 0, affected_ids: [] };
  }

  const placeholders = ids.map(() => "?").join(",");
  const now = Date.now();

  const memRes = db.prepare(`UPDATE memories SET is_active = 0, updated_at = ? WHERE id IN (${placeholders})`).run(now, ...ids);
  const tripRes = db.prepare(`UPDATE entity_triples SET is_active = 0, valid_until = ? WHERE memory_id IN (${placeholders})`).run(now, ...ids);

  for (const id of ids) {
    recordMemoryEvent(db, id, "PURGED", "Purged via deleteBySource (Provenance clean)", options.peer || "system");
  }

  return {
    memories_deleted: memRes.changes,
    triples_deleted: tripRes.changes,
    affected_ids: ids,
  };
}

/**
 * Delete a specific fact by ID (Hermes DELETE /facts/:id)
 */
export function deleteFactById(db: Database, id: string): boolean {
  const mem = db.query(`SELECT id FROM memories WHERE id = ?`).get(id) as any;
  if (!mem) return false;
  const now = Date.now();
  db.query(`UPDATE memories SET is_active = 0, status = 'superseded', updated_at = ? WHERE id = ?`).run(now, id);
  db.query(`UPDATE entity_triples SET is_active = 0 WHERE memory_id = ?`).run(id);
  recordMemoryEvent(db, id, "SUPERSEDED", `Fact explicitly deleted via Hermes DELETE /facts/${id}`, "hermes");
  return true;
}

/**
 * Enforce Capacity Bounds: evict lowest scoring facts when total facts > maxCapacity
 */
export function evictLowScoreFacts(db: Database, maxCapacity: number = 1000): number {
  const countRow = db.query(`SELECT COUNT(*) as c FROM memories WHERE is_active = 1`).get() as any;
  const currentCount = countRow?.c || 0;
  if (currentCount <= maxCapacity) return 0;

  const excess = currentCount - maxCapacity;
  const rows = db.query(`
    SELECT id, created_at, access_count, confidence, importance, is_negative_constraint
    FROM memories 
    WHERE is_active = 1 AND is_negative_constraint = 0
    ORDER BY (confidence * (CASE importance WHEN 'critical' THEN 10 WHEN 'high' THEN 3 WHEN 'normal' THEN 1 ELSE 0.5 END) * access_count / (1 + (strftime('%s','now') - created_at/1000)/86400)) ASC
    LIMIT ?
  `).all(excess) as any[];

  let evicted = 0;
  const now = Date.now();
  for (const r of rows) {
    db.query(`UPDATE memories SET is_active = 0, status = 'expired', updated_at = ? WHERE id = ?`).run(now, r.id);
    db.query(`UPDATE entity_triples SET is_active = 0 WHERE memory_id = ?`).run(r.id);
    recordMemoryEvent(db, r.id, "PURGED", "Evicted due to capacity limits (lowest retention score)", "system");
    evicted++;
  }
  return evicted;
}

/**
 * TTL Sweeper: cleans expired records whose valid_until < now
 */
export function sweepExpiredFacts(db: Database): number {
  const now = Date.now();
  const expired = db.query(`
    SELECT id FROM memories 
    WHERE is_active = 1 AND valid_until IS NOT NULL AND valid_until < ?
  `).all(now) as any[];

  for (const e of expired) {
    db.query(`UPDATE memories SET is_active = 0, status = 'expired', updated_at = ? WHERE id = ?`).run(now, e.id);
    db.query(`UPDATE entity_triples SET is_active = 0 WHERE memory_id = ?`).run(e.id);
    recordMemoryEvent(db, e.id, "PURGED", "Expired via TTL validity window", "sweeper");
  }
  return expired.length;
}

/**
 * Hermes Multi-Agent Ingest: stores raw message/event in notes and auto-promotes facts
 */
export async function ingestMessageOrFact(
  db: Database,
  options: IngestOptions
): Promise<IngestResult> {
  const peer = options.peer || "user";
  const sessionId = options.session_id || undefined;
  const role = options.role || "user";
  const content = options.content.trim();
  const now = Date.now();

  // 1. Layer 3 (Notes): Always append to notes raw history
  const noteInsert = db.prepare(`
    INSERT INTO notes (peer, session_id, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(peer, sessionId || null, role, content, now);

  const noteId = Number(noteInsert.lastInsertRowid);

  // 2. Filter noise: if transactional noise, do NOT promote to facts layer
  if (isTransactionalNoise(content, options.category)) {
    return {
      stored_in_notes: true,
      note_id: noteId,
      stored_in_facts: false,
      action: "ingested_note",
    };
  }

  // 3. Promote to facts layer only if explicitly requested (is_fact: true or type: "declarative")
  const isFact = options.is_fact === true || options.type === "declarative";

  if (isFact) {
    const ttlMs = options.ttl_ms ? now + options.ttl_ms : undefined;
    const confidence = options.confidence !== undefined ? options.confidence : 1.0;
    const fingerprint = computeFingerprint(content);

    // Try extracting triples
    const extracted = extractTriples(content);
    if (extracted.length > 0) {
      let mainRes: any = null;
      for (const t of extracted) {
        mainRes = await upsertFact(db, {
          subject: t.subject,
          predicate: t.predicate,
          raw_predicate: t.raw_predicate,
          object: t.object,
          content,
          peer,
          source_session: sessionId,
          confidence,
          valid_until: ttlMs,
          category: options.category,
        });
      }
      evictLowScoreFacts(db, 1000);

      return {
        stored_in_notes: true,
        note_id: noteId,
        stored_in_facts: true,
        fact_id: mainRes?.fact_id,
        memory_id: mainRes?.memory_id,
        fingerprint,
        action: mainRes?.action === "reinforced" ? "reinforced_fact" : "inserted_fact",
      };
    } else {
      // General declarative statement
      const memId = await rememberMemory(db, {
        content,
        peer,
        source_session: sessionId,
        category: options.category || "fact",
        importance: "normal",
        valid_until: ttlMs,
        memory_type: options.type || "declarative",
        confidence,
        skip_note_log: true,
      });

      evictLowScoreFacts(db, 1000);

      return {
        stored_in_notes: true,
        note_id: noteId,
        stored_in_facts: true,
        memory_id: memId,
        fingerprint,
        action: "inserted_fact",
      };
    }
  }

  return {
    stored_in_notes: true,
    note_id: noteId,
    stored_in_facts: false,
    action: "ingested_note",
  };
}

/**
 * Hermes Observability & Stats Monitor (GET /stats)
 */
export function getHermesStats(db: Database): HermesStats {
  const totalMem = (db.query(`SELECT COUNT(*) as c FROM memories`).get() as any)?.c || 0;
  const activeFacts = (db.query(`SELECT COUNT(*) as c FROM memories WHERE is_active = 1 AND memory_type = 'declarative'`).get() as any)?.c || 0;
  const supersededFacts = (db.query(`SELECT COUNT(*) as c FROM memories WHERE is_active = 0 AND status = 'superseded'`).get() as any)?.c || 0;
  const notesCount = (db.query(`SELECT COUNT(*) as c FROM notes`).get() as any)?.c || 0;
  const patternsCount = (db.query(`SELECT COUNT(*) as c FROM patterns`).get() as any)?.c || 0;
  const dreamsCount = (db.query(`SELECT COUNT(*) as c FROM dreams`).get() as any)?.c || 0;
  const evictionCount = (db.query(`SELECT COUNT(*) as c FROM memory_events WHERE event_type = 'PURGED'`).get() as any)?.c || 0;

  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(CONFIG.DB_PATH)) {
      dbSizeBytes = fs.statSync(CONFIG.DB_PATH).size;
    }
  } catch {}

  const freeRamMb = Math.round(os.freemem() / (1024 * 1024));

  return {
    total_memories: totalMem,
    active_facts: activeFacts,
    superseded_facts: supersededFacts,
    notes_count: notesCount,
    patterns_count: patternsCount,
    dreams_count: dreamsCount,
    eviction_count: evictionCount,
    db_size_bytes: dbSizeBytes,
    db_size_formatted: `${(dbSizeBytes / 1024).toFixed(2)} KB`,
    free_ram_mb: freeRamMb,
  };
}


