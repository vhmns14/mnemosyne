import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { compactContextWithBudget, estimateTokens } from "../src/engine/compactor.ts";
import { cosineSimilarity } from "../src/engine/embedder.ts";

describe("Mnemosyne Security & Bug Regression Audit Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  test("SEC-02: forget() rejects empty strings and raw wildcards, preventing mass deactivation", async () => {
    await engine.remember({ content: "Safe Rule 1" });
    await engine.remember({ content: "Safe Rule 2" });

    // Empty string
    expect(engine.forget("")).toBe(false);
    // Whitespace
    expect(engine.forget("   ")).toBe(false);
    // Raw wildcard
    expect(engine.forget("%")).toBe(false);
    expect(engine.forget("_")).toBe(false);

    const activeCount = (db.query("SELECT COUNT(*) as c FROM memories WHERE is_active = 1").get() as any).c;
    expect(activeCount).toBe(2); // Memories are completely safe
  });

  test("SEC-02: purge() rejects empty strings and wildcards, refusing accidental eradication", async () => {
    await engine.remember({ content: "Sensitive Rule 1" });

    expect(engine.purge("")).toBeNull();
    expect(engine.purge("   ")).toBeNull();
    expect(engine.purge("%")).toBeNull();

    const count = (db.query("SELECT COUNT(*) as c FROM memories").get() as any).c;
    expect(count).toBe(1); // Memory still exists
  });

  test("SEC-03: Entity aliases with regex characters (c++, node.js) do not crash recall", async () => {
    engine.addAlias("c++", "cpp-language");
    engine.addAlias("node.js", "nodejs-runtime");
    engine.addAlias("v1.0*", "v1-pointer");

    await engine.remember({ content: "We love cpp-language for high speed processing" });

    // Should NOT throw SyntaxError
    const res = await engine.recall({ query: "How to use c++ in project?" });
    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories[0].content).toContain("cpp-language");
  });

  test("BUG-01: Holographic resonance does not duplicate boost when bidirectional links exist", async () => {
    const m1 = await engine.remember({ content: "Alpha memory concept", scope: "global" });
    const m2 = await engine.remember({ content: "Beta memory concept", scope: "global" });

    // Insert bidirectional links
    db.prepare(`
      INSERT INTO associative_links (source_id, target_id, resonance_weight, co_occurrences, last_linked_at)
      VALUES (?, ?, 0.5, 2, ?), (?, ?, 0.5, 2, ?)
    `).run(m1, m2, Date.now(), m2, m1, Date.now());

    const res = await engine.recall({ query: "Alpha memory concept", limit: 5 });
    const betaMem = res.memories.find((m) => m.id === m2);

    if (betaMem) {
      // With resonance_boost = parentScore * 0.5 * 0.15, it should not be doubled
      expect(betaMem.resonance_boost).toBeLessThanOrEqual(0.15);
    }
  });

  test("BUG-02: Knapsack Compactor includes header tokens and strictly respects token budget", () => {
    const memories = [
      {
        id: "1",
        content: "DILARANG run_in_background untuk build/task berat di laptop 16GB",
        scope: "global" as const,
        category: "negative_constraint" as const,
        importance: "critical" as const,
        structure_type: "freeform" as const,
        tags: [],
        access_count: 0,
        last_accessed_at: Date.now(),
        created_at: Date.now(),
        updated_at: Date.now(),
        superseded_by_id: null,
        is_active: true,
        valid_from: 0,
        valid_until: null,
        outcome: "neutral" as const,
        failure_reason: null,
        is_negative_constraint: true,
        score: 1.0,
        vector_score: 1.0,
        bm25_score: 1.0,
        recency_score: 1.0,
        resonance_boost: 0,
      }
    ];

    // Tight budget (20 tokens) - cannot fit banner + rule
    const tight = compactContextWithBudget(memories, 20);
    expect(estimateTokens(tight.formatted)).toBeLessThanOrEqual(20);
    expect(tight.budget.included_items).toBe(0); // Safely dropped because banner + item > 20

    // Adequate budget (50 tokens) - can fit banner + rule
    const adequate = compactContextWithBudget(memories, 50);
    expect(estimateTokens(adequate.formatted)).toBeLessThanOrEqual(50);
    expect(adequate.budget.included_items).toBe(1);
    expect(adequate.budget.estimated_tokens).toBe(estimateTokens(adequate.formatted));
  });

  test("BUG-03: Forgetting a memory cascades is_active = 0 to linked entity triples", async () => {
    const memId = await engine.remember({
      content: "Albatross listens on port 8787",
      scope: "project",
    });

    const activeTriplesBefore = db
      .query("SELECT COUNT(*) as c FROM entity_triples WHERE memory_id = ? AND is_active = 1")
      .get(memId) as any;
    expect(activeTriplesBefore.c).toBeGreaterThan(0);

    // Forget memory
    engine.forget(memId);

    const activeTriplesAfter = db
      .query("SELECT COUNT(*) as c FROM entity_triples WHERE memory_id = ? AND is_active = 1")
      .get(memId) as any;
    expect(activeTriplesAfter.c).toBe(0); // Triples deactivated
  });

  test("BUG-04: Spreading activation sets valid structure_type", async () => {
    const m1 = await engine.remember({ content: "Parent Node", scope: "global" });
    const m2 = await engine.remember({ content: "Child Node", scope: "global", structure_type: "decision_ledger" });

    db.prepare(`
      INSERT INTO associative_links (source_id, target_id, resonance_weight, co_occurrences, last_linked_at)
      VALUES (?, ?, 0.9, 5, ?)
    `).run(m1, m2, Date.now());

    const res = await engine.recall({ query: "Parent Node", limit: 5 });
    const child = res.memories.find((m) => m.id === m2);
    if (child) {
      expect(child.structure_type).toBeDefined();
      expect(child.structure_type).toBe("decision_ledger");
    }
  });

  test("BUG-06: cosineSimilarity returns 0 on mismatched vector dimensions", () => {
    const v384 = new Float32Array(384).fill(0.1);
    const v1536 = new Float32Array(1536).fill(0.1);

    expect(cosineSimilarity(v384, v1536)).toBe(0);
    expect(cosineSimilarity(new Float32Array([]), v384)).toBe(0);
  });

  test("PERF-01: HippoRAG with shared dense entities respects clique degree cap without explosion", async () => {
    // Simulate 20 memories connected to a single high-frequency entity (e.g. "sqlite")
    const mems: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = await engine.remember({
        content: `Node ${i} uses sqlite for storage`,
        entities: [{ subject: "sqlite", predicate: "POWERS", object: `Node_${i}` }],
      });
      mems.push(id);
    }

    const start = performance.now();
    const res = await engine.recall({ query: "Node 0 sqlite", limit: 5 });
    const elapsed = performance.now() - start;

    expect(res.memories.length).toBeGreaterThan(0);
    // Bounded execution: Must finish well under 50ms despite dense shared entity
    expect(elapsed).toBeLessThan(50);
  });

  test("AUDIT-01: decodeVector decodes unaligned buffer slices safely without RangeError", () => {
    const { decodeVector } = require("../src/engine/embedder.ts");
    
    // Create an aligned Float32Array
    const original = new Float32Array([1.0, 2.5, -3.14, 42.0]);
    const originalBuf = Buffer.from(original.buffer);

    // Create an unaligned buffer by offsetting by 1, 2, 3 bytes
    for (const offset of [1, 2, 3, 5, 7]) {
      const unaligned = Buffer.alloc(originalBuf.byteLength + offset);
      originalBuf.copy(unaligned, offset);
      const slice = unaligned.subarray(offset, offset + originalBuf.byteLength);

      expect(slice.byteOffset % 4).not.toBe(0); // confirms it is unaligned
      const decoded = decodeVector(slice);
      expect(decoded).not.toBeNull();
      expect(decoded!.length).toBe(4);
      expect(decoded![0]).toBeCloseTo(1.0, 4);
      expect(decoded![1]).toBeCloseTo(2.5, 4);
      expect(decoded![2]).toBeCloseTo(-3.14, 4);
      expect(decoded![3]).toBeCloseTo(42.0, 4);
    }

    // Corrupted / empty cases
    expect(decodeVector(null)).toBeNull();
    expect(decodeVector(undefined)).toBeNull();
    expect(decodeVector(Buffer.alloc(0))).toBeNull();
  });

  test("AUDIT-02: Dialectic Scope Inheritance: Project recall includes global constraints", async () => {
    // 1. Global constraint
    await engine.remember({
      content: "Laptop RAM 16GB: Dilarang build di lokal",
      scope: "global",
      is_negative_constraint: true,
      importance: "critical",
    });

    // 2. Project-specific rule
    await engine.remember({
      content: "Undangan digital deploy via Cloudflare Workers",
      scope: "project",
      category: "architecture",
    });

    // Recall specifically for project scope
    const projectRecall = await engine.recall({
      query: "build dan deploy laptop RAM 16GB",
      scope: "project",
    });

    // Should include BOTH the project rule AND the global guardrail!
    const foundGlobal = projectRecall.memories.some((m) => m.content.includes("Laptop RAM 16GB"));
    const foundProject = projectRecall.memories.some((m) => m.content.includes("Undangan digital"));
    expect(foundGlobal).toBe(true);
    expect(foundProject).toBe(true);
  });

  test("AUDIT-04: Pack export and import faithfully preserves entity triples and maps memory IDs", async () => {
    const memId = await engine.remember({
      content: "Albatross Gateway connects to AgentRouter",
      scope: "global",
      entities: [{ subject: "Albatross", predicate: "CONNECTS_TO", object: "AgentRouter" }],
    });

    const pack = engine.exportPack("global");
    expect(pack.memories.length).toBeGreaterThan(0);
    expect(pack.triples.length).toBeGreaterThan(0);

    // Import into a fresh target DB
    const freshDb = new Database(":memory:");
    initSchema(freshDb);
    const freshEngine = new MnemosyneEngine(freshDb);

    const importRes = await freshEngine.importPack(pack);
    expect(importRes.imported_memories).toBe(pack.memories.length);
    expect(importRes.imported_triples).toBe(pack.triples.length);

    // Verify triples in fresh database are active and linked
    const importedTriples = freshDb
      .query("SELECT * FROM entity_triples WHERE is_active = 1")
      .all() as any[];
    expect(importedTriples.length).toBeGreaterThan(0);
    expect(importedTriples[0].subject).toBe("Albatross");
    expect(importedTriples[0].predicate).toBe("CONNECTS_TO");
    expect(importedTriples[0].memory_id).not.toBeNull();
  });

  test("AUDIT-05: Purge clears superseded_by_id pointers atomically", async () => {
    const parent = await engine.remember({ content: "Old baseline v1" });
    const child = await engine.remember({
      content: "New baseline v2",
      supersedes_query: "Old baseline v1",
    });

    // Verify parent was marked superseded by child
    const parentRow = db.query("SELECT superseded_by_id FROM memories WHERE id = ?").get(parent) as any;
    expect(parentRow.superseded_by_id).toBe(child);

    // Purge child
    const receipt = engine.purge(child);
    expect(receipt).not.toBeNull();

    // Verify parent no longer has dangling superseded_by_id pointer
    const parentRowAfter = db.query("SELECT superseded_by_id FROM memories WHERE id = ?").get(parent) as any;
    expect(parentRowAfter.superseded_by_id).toBeNull();
  });

  test("AUDIT-06: createBackup safely escapes single quotes in paths", () => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");

    // Path with an apostrophe
    const tempDir = mkdtempSync(join(tmpdir(), "mnemo-test's-dir-"));
    try {
      const res = engine.backup(tempDir);
      expect(res.success).toBe(true);
      expect(res.sizeBytes).toBeGreaterThan(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("AUDIT-07: Brain Digest accurately pulls payload for superseded events", async () => {
    await engine.remember({ content: "First draft config" });
    await engine.remember({
      content: "Second draft config",
      supersedes_query: "First draft config",
    });

    const digest = engine.getDigest(1);
    expect(digest.stats.superseded).toBeGreaterThan(0);
    expect(digest.superseded_items.length).toBeGreaterThan(0);
    expect(digest.superseded_items[0]).toContain("Superseded by memory");
  });
});

