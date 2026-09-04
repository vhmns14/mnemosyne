import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";

describe("Hermes Agent 3-Layer Cognitive Architecture & Protocol", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  it("1. STORAGE: 3-Layer Architecture (card, facts, notes, patterns, dreams, meta)", async () => {
    // Ingest raw message into notes
    const ingestRes = await engine.ingest({
      peer: "hermes",
      session_id: "session_alpha",
      role: "user",
      content: "Dek prefers dark mode in all IDEs",
      type: "declarative",
    });

    expect(ingestRes.stored_in_notes).toBe(true);
    expect(ingestRes.note_id).toBeDefined();
    expect(ingestRes.stored_in_facts).toBe(true);

    // Layer 1: Standing Card
    const card = engine.getCard({ peer: "hermes" });
    expect(card.facts.length).toBeGreaterThan(0);
    expect(card.formatted).toContain("Dek prefers dark mode in all IDEs");

    // Layer 2: Facts Table & View
    const factsRow = db.query(`SELECT * FROM facts WHERE peer = 'hermes'`).get() as any;
    expect(factsRow).toBeDefined();
    expect(factsRow.fact).toContain("Dek prefers dark mode in all IDEs");
    expect(factsRow.type).toBe("declarative");
    expect(factsRow.status).toBe("active");
    expect(factsRow.confidence).toBe(1.0);

    // Layer 3: Notes & Patterns tables
    const noteRow = db.query(`SELECT * FROM notes WHERE id = ?`).get(ingestRes.note_id) as any;
    expect(noteRow).toBeDefined();
    expect(noteRow.content).toBe("Dek prefers dark mode in all IDEs");
  });

  it("2. INGESTA: Hash Fingerprint Fast-Path Dedup & Noise Filtering", async () => {
    // A. Noise Filtering: transactional execution messages must NOT become standing facts
    const noiseRes = await engine.ingest({
      peer: "hermes",
      session_id: "session_beta",
      role: "assistant",
      content: "running command: bun test && exit code 0",
      category: "task_progress",
    });

    expect(noiseRes.stored_in_notes).toBe(true);
    expect(noiseRes.stored_in_facts).toBe(false);
    expect(noiseRes.action).toBe("ingested_note");

    // Verify noise didn't enter facts or standing card
    const cardAfterNoise = engine.getCard();
    expect(cardAfterNoise.formatted).not.toContain("running command");

    // B. Hash Fingerprint Deduplication (0 MB RAM, instant zero-LLM reinforcement)
    const factText = "Cloudflare Workers deploy via git push to main branch";
    const firstAdd = await engine.remember({
      content: factText,
      peer: "hermes",
    });

    const secondAdd = await engine.remember({
      content: "  cloudflare workers deploy via git push to main branch  ", // minor casing and whitespace variation
      peer: "hermes",
    });

    // Should return identical memory ID (deduplicated)
    expect(secondAdd).toBe(firstAdd);

    // Verify access count incremented and confidence reinforced
    const memRow = db.query(`SELECT access_count, confidence FROM memories WHERE id = ?`).get(firstAdd) as any;
    expect(memRow.access_count).toBeGreaterThanOrEqual(1);
    expect(memRow.confidence).toBeGreaterThanOrEqual(1.0);
  });

  it("3. RETRIEVAL: Prompt-Aware Provenance Injection & Budget Packing", async () => {
    await engine.remember({
      content: "Production API gateway runs on port 8788",
      peer: "hermes",
      source_session: "session_prod_deploy",
    });

    const recallRes = await engine.recall({
      query: "gateway port",
      peer: "hermes",
      max_tokens: 200,
    });

    expect(recallRes.memories.length).toBeGreaterThan(0);
    // Prompt-aware formatting includes source session tag
    expect(recallRes.formatted).toContain("[src:session_prod_deploy]");
    expect(recallRes.token_budget?.used_tokens || recallRes.token_budget?.estimated_tokens).toBeLessThanOrEqual(200);
  });

  it("4. HYGIENE: TTL Sweeper, Delete API & Observability Stats", async () => {
    const pastTime = Date.now() - 5000;
    const futureTime = Date.now() + 100000;

    // Create an expired memory
    const expiredId = await engine.remember({
      content: "Temporary cache token expires immediately",
      valid_until: pastTime,
    });

    // Create an active memory
    const activeId = await engine.remember({
      content: "Persistent database connection string",
      valid_until: futureTime,
    });

    // Run TTL sweeper
    const sweptCount = engine.sweepExpired();
    expect(sweptCount).toBe(1);

    const expiredRow = db.query(`SELECT is_active, status FROM memories WHERE id = ?`).get(expiredId) as any;
    expect(expiredRow.is_active).toBe(0);
    expect(expiredRow.status).toBe("expired");

    // Single Fact Deletion API: DELETE /facts/:id
    const deleted = engine.deleteFact(activeId);
    expect(deleted).toBe(true);

    const activeMemAfter = db.query(`SELECT is_active, status FROM memories WHERE id = ?`).get(activeId) as any;
    expect(activeMemAfter.is_active).toBe(0);
    expect(activeMemAfter.status).toBe("superseded");

    // Stats Monitor (GET /stats)
    const stats = engine.getStats();
    expect(stats.total_memories).toBeGreaterThanOrEqual(2);
    expect(stats.active_facts).toBeDefined();
    expect(stats.free_ram_mb).toBeGreaterThan(0);
  });

  it("5. CAPACITY: Enforces fact capacity limit by evicting lowest scoring records", async () => {
    // Insert 5 low importance unaccessed memories
    for (let i = 1; i <= 5; i++) {
      await engine.remember({
        content: `Low priority ephemeral note ${i}`,
        importance: "low",
      });
    }

    // Set maxCapacity to 3
    const evicted = engine.evictLowScore(3);
    expect(evicted).toBe(2);

    const activeRemaining = db.query(`SELECT COUNT(*) as c FROM memories WHERE is_active = 1`).get() as any;
    expect(activeRemaining.c).toBe(3);
  });

  it("6. DREAMING: Honcho-style Delta Reflection with Watermark Tracking", async () => {
    // Ingest conversation sequence into notes layer
    await engine.ingest({
      peer: "hermes",
      session_id: "session_dream_test",
      content: "Vahmi selalu menggunakan port 8788 untuk service backend",
    });

    await engine.ingest({
      peer: "hermes",
      session_id: "session_dream_test",
      content: "Dek suka matcha latte",
    });

    // Run first dream pass
    const dream1 = await engine.dreamHermes({ session_id: "session_dream_test", force: true });
    expect(dream1.input_delta_count).toBe(2);
    expect(dream1.facts_added).toBeGreaterThanOrEqual(1);
    expect(dream1.patterns_found).toBeGreaterThanOrEqual(1);

    // Verify watermark was saved in meta table
    const watermark = db.query(`SELECT value FROM meta WHERE key = 'last_dreamed_message_id'`).get() as any;
    expect(watermark).toBeDefined();
    expect(parseInt(watermark.value, 10)).toBeGreaterThan(0);

    // Verify pattern recorded with confidence and source note IDs
    const patterns = db.query(`SELECT * FROM patterns WHERE peer = 'hermes'`).all() as any[];
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].pattern).toContain("Vahmi selalu menggunakan port 8788");
    expect(patterns[0].confidence).toBeGreaterThanOrEqual(0.8);

    // Second run without new notes should find 0 delta
    const dream2 = await engine.dreamHermes({ session_id: "session_dream_test", force: true });
    expect(dream2.input_delta_count).toBe(0);
    expect(dream2.facts_added).toBe(0);
  });
});
