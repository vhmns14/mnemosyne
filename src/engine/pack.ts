import type { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { rememberMemory } from "./dialectic.ts";
import { addEntityAlias } from "./dialectic.ts";
import type { MemoryPack } from "../types.ts";

export function computePackChecksum(pack: { memories: any[]; triples: any[]; aliases: any[] }): string {
  const normalized = JSON.stringify({
    memories: (pack.memories || []).map((m) => ({ id: m.id, content: m.content, scope: m.scope })),
    triples: (pack.triples || []).map((t) => ({ subject: t.subject, predicate: t.predicate, object: t.object })),
    aliases: (pack.aliases || []).map((a) => ({ alias: a.alias, canonical_name: a.canonical_name })),
  });
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Portable Memory Pack Exporter
 * Exports sanitized memories, triples, and aliases into a portable JSON package
 * with SHA-256 integrity checksum. Zero .db files needed!
 */
export function exportMemoryPack(db: Database, scope: string = "all"): MemoryPack {
  let memSql = "SELECT * FROM memories WHERE is_active = 1";
  const params: any[] = [];
  if (scope !== "all") {
    memSql += " AND scope = ?";
    params.push(scope);
  }

  const memoryRows = db.query(memSql).all(...params) as any[];
  const memoryIds = memoryRows.map((m) => m.id);

  let triples: any[] = [];
  if (memoryIds.length > 0) {
    const placeholders = memoryIds.map(() => "?").join(",");
    triples = db
      .query(`SELECT id, subject, predicate, object, memory_id, confidence, is_active, valid_from, valid_until FROM entity_triples WHERE is_active = 1 AND memory_id IN (${placeholders})`)
      .all(...memoryIds);
  }

  const aliases = db.query("SELECT alias, canonical_name FROM entity_aliases").all() as any[];

  const memories = memoryRows.map((m) => ({
    id: m.id,
    content: m.content,
    scope: m.scope,
    category: m.category,
    importance: m.importance,
    structure_type: m.structure_type || "freeform",
    tags: JSON.parse(m.tags || "[]"),
    created_at: m.created_at,
    updated_at: m.updated_at,
    superseded_by_id: m.superseded_by_id,
    is_active: Boolean(m.is_active),
    valid_from: m.valid_from,
    valid_until: m.valid_until,
    outcome: m.outcome,
    failure_reason: m.failure_reason,
    is_negative_constraint: Boolean(m.is_negative_constraint),
  }));

  const triplesMapped = triples.map((t) => ({
    id: t.id,
    subject: t.subject,
    predicate: t.predicate,
    object: t.object,
    memory_id: t.memory_id,
    confidence: t.confidence,
    is_active: Boolean(t.is_active),
    valid_from: t.valid_from,
    valid_until: t.valid_until,
  }));

  const aliasesMapped = aliases.map((a) => ({
    alias: a.alias,
    canonical_name: a.canonical_name,
  }));

  const checksum = computePackChecksum({
    memories,
    triples: triplesMapped,
    aliases: aliasesMapped,
  });

  return {
    version: "1.0.0",
    exported_at: Date.now(),
    scope,
    checksum,
    memories,
    triples: triplesMapped,
    aliases: aliasesMapped,
  };
}

/**
 * Portable Memory Pack Importer
 * Ingests a pack, verifies checksum, generates fresh local vector embeddings,
 * and re-indexes everything seamlessly.
 */
export async function importMemoryPack(
  db: Database,
  packInput: string | MemoryPack
): Promise<{ imported_memories: number; imported_triples: number; imported_aliases: number }> {
  if (!packInput) throw new Error("Memory pack input cannot be empty.");
  let pack: any;
  if (typeof packInput === "string") {
    try {
      pack = JSON.parse(packInput);
    } catch (err: any) {
      throw new Error(`Invalid memory pack JSON: ${err.message}`);
    }
  } else {
    pack = packInput;
  }

  if (!pack || typeof pack !== "object") {
    throw new Error("Invalid memory pack: root must be a JSON object.");
  }

  const memories = Array.isArray(pack.memories) ? pack.memories : [];
  const triples = Array.isArray(pack.triples) ? pack.triples : [];
  const aliases = Array.isArray(pack.aliases) ? pack.aliases : [];

  // Verify cryptographic checksum
  if (pack.checksum) {
    const expectedChecksum = computePackChecksum({
      memories,
      triples,
      aliases,
    });
    if (pack.checksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch: pack data has been tampered with or corrupted (expected ${expectedChecksum}, got ${pack.checksum})`);
    }
  }

  let memCount = 0;
  const oldToNewMemId = new Map<string, string>();

  for (const m of memories) {
    const newId = await rememberMemory(db, {
      content: m.content,
      scope: m.scope,
      category: m.category,
      importance: m.importance,
      structure_type: m.structure_type,
      tags: m.tags,
      valid_from: m.valid_from,
      valid_until: m.valid_until,
      outcome: m.outcome,
      failure_reason: m.failure_reason,
      is_negative_constraint: m.is_negative_constraint,
    });
    if (m.id) {
      oldToNewMemId.set(m.id, newId);
    }
    memCount++;
  }

  let tripleCount = 0;
  if (triples.length > 0) {
    const insertTripleStmt = db.prepare(`
      INSERT OR IGNORE INTO entity_triples (
        id, subject, predicate, object, memory_id, confidence, is_active, valid_from, valid_until, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const t of triples) {
      const targetMemoryId = t.memory_id ? (oldToNewMemId.get(t.memory_id) || null) : null;
      insertTripleStmt.run(
        randomUUID(),
        t.subject,
        t.predicate,
        t.object,
        targetMemoryId,
        t.confidence ?? 1.0,
        t.is_active ? 1 : 0,
        t.valid_from ?? Date.now(),
        t.valid_until ?? null,
        Date.now()
      );
      tripleCount++;
    }
  }

  let aliasCount = 0;
  for (const a of aliases) {
    addEntityAlias(db, a.alias, a.canonical_name);
    aliasCount++;
  }

  return {
    imported_memories: memCount,
    imported_triples: tripleCount,
    imported_aliases: aliasCount,
  };
}
