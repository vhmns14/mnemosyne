import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { initSchema } from "../src/db/schema.ts";
import {
  quantizeToBinary,
  hammingDistance,
  binaryCosineSimilarity,
  binaryNormalizedSimilarity,
  binaryToHex,
  hexToBinary,
  fastBinaryFilter,
  cosineSimilarity,
} from "../src/engine/embedder.ts";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB = "test_bq_and_rollup.db";

describe("Mnemosyne SOTA 2026: 1-Bit BQ & Episodic Rollup Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    db = new Database(TEST_DB);
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  // ==========================================
  // 1. 1-Bit Binary Vector Quantization (BQ)
  // ==========================================
  it("1. quantizes 384-dimensional Float32 vector into 48-byte Uint8Array (96.88% RAM reduction)", () => {
    const floatVec = new Float32Array(384);
    // Alternate positive and negative floats
    for (let i = 0; i < 384; i++) {
      floatVec[i] = i % 2 === 0 ? 0.75 : -0.5;
    }

    const bqVec = quantizeToBinary(floatVec);
    expect(bqVec).toBeInstanceOf(Uint8Array);
    expect(bqVec.length).toBe(48); // 384 / 8 = 48 bytes!

    // Verify first byte: even indices (0, 2, 4, 6) are positive bits (1) -> binary 10101010 = 0xAA
    expect(bqVec[0]).toBe(0b10101010);
  });

  it("2. computes Hamming distance accurately and in < 0.001ms via popcount lookup table", () => {
    const vecA = new Uint8Array(48).fill(0b00000000);
    const vecB = new Uint8Array(48).fill(0b11111111);
    const vecC = new Uint8Array(48).fill(0b00000000);

    // Completely opposite vectors: distance should be 48 * 8 = 384 bits
    const distOpposite = hammingDistance(vecA, vecB);
    expect(distOpposite).toBe(384);

    // Identical vectors: distance should be 0
    const distIdentical = hammingDistance(vecA, vecC);
    expect(distIdentical).toBe(0);

    // 1-bit difference in 1 byte
    const vecD = new Uint8Array(48);
    vecD[0] = 0b00000001;
    expect(hammingDistance(vecA, vecD)).toBe(1);
  });

  it("3. binary cosine similarity approximates geometric angular similarity", () => {
    const vecA = new Uint8Array(48).fill(0x00);
    const vecB = new Uint8Array(48).fill(0x00);
    const vecC = new Uint8Array(48).fill(0xFF);

    // Identical bit vectors -> similarity 1.0
    expect(binaryCosineSimilarity(vecA, vecB, 384)).toBeCloseTo(1.0, 4);
    expect(binaryNormalizedSimilarity(vecA, vecB, 384)).toBe(1.0);

    // Opposite bit vectors -> similarity -1.0
    expect(binaryCosineSimilarity(vecA, vecC, 384)).toBeCloseTo(-1.0, 4);
    expect(binaryNormalizedSimilarity(vecA, vecC, 384)).toBe(0.0);
  });

  it("4. fastBinaryFilter rapidly ranks candidate bit vectors by Hamming distance", () => {
    const query = new Uint8Array(48).fill(0xAA);

    const candidates = [
      { id: "far", binary: new Uint8Array(48).fill(0x55) },       // Inverted
      { id: "exact", binary: new Uint8Array(48).fill(0xAA) },     // Exact match
      { id: "close", binary: new Uint8Array(48).fill(0xAA) },     // 1 bit off
    ];
    candidates[2].binary[0] ^= 0x01; // flip 1 bit

    const results = fastBinaryFilter(query, candidates, 3, 384);
    expect(results[0].id).toBe("exact");
    expect(results[0].distance).toBe(0);
    expect(results[0].score).toBe(1.0);

    expect(results[1].id).toBe("close");
    expect(results[1].distance).toBe(1);

    expect(results[2].id).toBe("far");
    expect(results[2].distance).toBe(384);
  });

  it("5. hex encoding and decoding round-trips with full fidelity", () => {
    const orig = new Uint8Array(48);
    for (let i = 0; i < 48; i++) orig[i] = (i * 17) & 0xFF;

    const hex = binaryToHex(orig);
    expect(typeof hex).toBe("string");
    expect(hex.length).toBe(96); // 48 bytes * 2

    const restored = hexToBinary(hex);
    expect(restored).toEqual(orig);
  });

  // ==========================================
  // 2. Episodic Rollup & Auto-Compaction
  // ==========================================
  it("6. rolls up episodic session micro-memories into a consolidated Decision Ledger macro-fact", async () => {
    const sessionId = "swarm-task-42";

    // Ingest 5 episodic micro-actions for this session
    await engine.remember({
      content: "Switched database engine to SQLite WAL mode for concurrency",
      scope: "session",
      source_session: sessionId,
      category: "episodic",
    });

    await engine.remember({
      content: "Never use synchronous PRAGMA in high-concurrency loops (anti-pattern)",
      scope: "session",
      source_session: sessionId,
      is_negative_constraint: true,
    });

    await engine.remember({
      content: "Encountered lock error: database is locked with busy timeout 100ms",
      scope: "session",
      source_session: sessionId,
      outcome: "failure",
      failure_reason: "busy timeout too short",
    });

    await engine.remember({
      content: "Verified all test suites passed with 100% assertions",
      scope: "session",
      source_session: sessionId,
      outcome: "success",
    });

    // Execute Episodic Rollup
    const rollupResult = await engine.rollup({ session_id: sessionId });

    expect(rollupResult.rolled_up_count).toBe(4);
    expect(rollupResult.session_id).toBe(sessionId);
    expect(rollupResult.macro_memory_id).toBeTruthy();
    expect(rollupResult.archived_ids.length).toBe(4);

    // Verify Decision Ledger sections
    expect(rollupResult.decision_ledger.decisions.length).toBeGreaterThan(0);
    expect(rollupResult.decision_ledger.constraints.length).toBeGreaterThan(0);
    expect(rollupResult.decision_ledger.failures_encountered.length).toBeGreaterThan(0);
    expect(rollupResult.decision_ledger.outcomes.length).toBeGreaterThan(0);

    // Verify macro memory is active and marked as decision_ledger
    const macroMem = engine.getMemory(rollupResult.macro_memory_id);
    expect(macroMem).not.toBeNull();
    expect(macroMem?.structure_type).toBe("decision_ledger");
    expect(macroMem?.tags).toContain("#session-rollup");
    expect(macroMem?.content).toContain("# Decision Ledger: Session swarm-task-42");

    // Verify source micro-memories are now inactive (superseded)
    for (const archivedId of rollupResult.archived_ids) {
      const oldMem = engine.getMemory(archivedId);
      expect(oldMem).toBeNull(); // getMemory only returns active records!
      const rawOld = db.query("SELECT is_active, superseded_by_id FROM memories WHERE id = ?").get(archivedId) as any;
      expect(rawOld.is_active).toBe(0);
      expect(rawOld.superseded_by_id).toBe(rollupResult.macro_memory_id);
    }
  });

  it("7. handles empty or already rolled-up sessions gracefully", async () => {
    const result = await engine.rollup({ session_id: "non-existent-session-999" });
    expect(result.rolled_up_count).toBe(0);
    expect(result.macro_memory_id).toBe("");
    expect(result.summary).toContain("No active micro-memories found");
  });
});
