import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";

describe("Mnemosyne Holographic Resonance & Conflict Invalidation", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  test("activates associative links via spreading resonance", async () => {
    const mem1 = await engine.remember({
      content: "Albatross Gateway architecture",
      scope: "project",
    });

    const mem2 = await engine.remember({
      content: "Indonesian NIK Masking Guardrail regex",
      scope: "project",
    });

    // Manually create an associative link between mem1 and mem2
    db.prepare(`
      INSERT INTO associative_links (source_id, target_id, resonance_weight, co_occurrences, last_linked_at)
      VALUES (?, ?, 0.8, 5, ?)
    `).run(mem1, mem2, Date.now());

    // Query specifically for Albatross Gateway
    const res = await engine.recall({
      query: "Albatross Gateway",
      enable_resonance: true,
      limit: 5,
    });

    // Both should be in recall results, and mem2 should have resonance boost
    const ids = res.memories.map((m) => m.id);
    expect(ids).toContain(mem1);
    expect(ids).toContain(mem2);

    const recalledMem2 = res.memories.find((m) => m.id === mem2);
    expect(recalledMem2?.resonance_boost).toBeGreaterThan(0);
  });

  test("invalidates old contradictory memory upon supersession", async () => {
    const oldId = await engine.remember({
      content: "User prefers Fastify framework for all Node backends",
      category: "preference",
    });

    // User updates preference and supersedes Fastify
    const newId = await engine.remember({
      content: "User prefers Hono framework with Bun runtime",
      category: "preference",
      supersedes_query: "Fastify",
    });

    // Check that oldId is marked inactive
    const oldMem = db.query(`SELECT is_active, superseded_by_id FROM memories WHERE id = ?`).get(oldId) as any;
    expect(oldMem.is_active).toBe(0);
    expect(oldMem.superseded_by_id).toBe(newId);

    // Active recall should only return the new memory
    const res = await engine.recall({
      query: "framework backend user",
    });

    expect(res.memories.map((m) => m.id)).not.toContain(oldId);
    expect(res.memories.map((m) => m.id)).toContain(newId);
  });
});
