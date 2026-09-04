import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { CONFIG } from "../src/config.ts";

describe("Production Critique Fixes & Verification", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
  });

  test("1. Scores are strictly capped <= 1.0 (100%) even with stacked multipliers", async () => {
    // Add memory with multiple boosts: critical importance (1.35) + negative constraint (1.45)
    await engine.remember({
      content: "DILARANG run_in_background untuk task berat di laptop 16GB",
      importance: "critical",
      is_negative_constraint: true,
      category: "rule",
    });

    const res = await engine.recall({
      query: "DILARANG run_in_background task berat laptop 16GB",
      limit: 5,
    });

    expect(res.memories.length).toBeGreaterThan(0);
    for (const mem of res.memories) {
      expect(mem.score).toBeLessThanOrEqual(1.0);
      expect(mem.score).toBeGreaterThan(0.0);
    }
  });

  test("2. Automatic polarity conflict invalidation in rememberMemory", async () => {
    // 1st statement: Dek likes americano
    const m1 = await engine.remember({
      content: "Dek likes americano",
      category: "preference",
    });

    // Verify m1 is active
    let row1 = db.query("SELECT is_active, status FROM memories WHERE id = ?").get(m1) as any;
    expect(row1.is_active).toBe(1);
    expect(row1.status).toBe("active");

    // 2nd statement: Dek dislikes americano (opposing polarity via OPPOSITES dictionary)
    const m2 = await engine.remember({
      content: "Dek dislikes americano",
      category: "preference",
    });

    // Verify m1 was automatically superseded by m2
    row1 = db.query("SELECT is_active, status, superseded_by_id, contradiction_count FROM memories WHERE id = ?").get(m1) as any;
    expect(row1.is_active).toBe(0);
    expect(row1.status).toBe("superseded");
    expect(row1.superseded_by_id).toBe(m2);
    expect(row1.contradiction_count).toBe(1);

    // Verify m2 is active
    const row2 = db.query("SELECT is_active, status FROM memories WHERE id = ?").get(m2) as any;
    expect(row2.is_active).toBe(1);
    expect(row2.status).toBe("active");

    // Verify recalled context prioritizes current truth (m2) and omits superseded fact (m1)
    const recalled = await engine.recall({ query: "Dek americano" });
    const recalledIds = recalled.memories.map((m) => m.id);
    expect(recalledIds).toContain(m2);
    expect(recalledIds).not.toContain(m1);
  });

  test("3. Real-time TTL invalidation in recall and remember", async () => {
    const pastTime = Date.now() - 5000;
    // Insert an expired memory directly or with valid_until in the past
    const expId = await engine.remember({
      content: "Transient session token valid for 1ms",
      valid_until: pastTime,
    });

    // Recall triggers sweepExpiredFacts inline
    const res = await engine.recall({ query: "Transient session token" });
    expect(res.memories.find((m) => m.id === expId)).toBeUndefined();

    // Check that SQLite database status is immediately updated without manual consolidate
    const row = db.query("SELECT is_active, status FROM memories WHERE id = ?").get(expId) as any;
    expect(row.is_active).toBe(0);
    expect(row.status).toBe("expired");
  });

  test("4. Safe forget prevents accidental substring mass wipes", async () => {
    const m1 = await engine.remember({ content: "Albatross Gateway is a proxy" });
    const m2 = await engine.remember({ content: "Proxy settings should be set to port 8787" });
    const m3 = await engine.remember({ content: "Exact Match Proxy" });

    // Short queries < 4 chars are rejected (unless exact match)
    expect(engine.forget("pro")).toBe(false);
    expect(engine.forget("ox")).toBe(false);

    // Exact match deactivates ONLY that exact record, not other records containing 'proxy'
    const forgetExact = engine.forget("Exact Match Proxy");
    expect(forgetExact).toBe(true);

    const checkM1 = db.query("SELECT is_active FROM memories WHERE id = ?").get(m1) as any;
    const checkM2 = db.query("SELECT is_active FROM memories WHERE id = ?").get(m2) as any;
    const checkM3 = db.query("SELECT is_active FROM memories WHERE id = ?").get(m3) as any;

    expect(checkM1.is_active).toBe(1); // Untouched!
    expect(checkM2.is_active).toBe(1); // Untouched!
    expect(checkM3.is_active).toBe(0); // Deactivated!
  });

  test("5. Recency feedback loop increments access_count and updates last_accessed_at", async () => {
    const memId = await engine.remember({
      content: "Persistent project guideline: use Bun test",
      category: "rule",
    });

    const rowBefore = db.query("SELECT access_count, last_accessed_at FROM memories WHERE id = ?").get(memId) as any;
    const initialCount = rowBefore.access_count;
    const initialAccessedAt = rowBefore.last_accessed_at;

    // Simulate 10ms passing
    await new Promise((r) => setTimeout(r, 10));

    // Recall memory
    const recallRes = await engine.recall({ query: "Bun test guideline" });
    expect(recallRes.memories.length).toBeGreaterThan(0);
    expect(recallRes.memories[0].id).toBe(memId);

    // Verify access_count incremented in DB
    const rowAfter = db.query("SELECT access_count, last_accessed_at FROM memories WHERE id = ?").get(memId) as any;
    expect(rowAfter.access_count).toBe(initialCount + 1);
    expect(rowAfter.last_accessed_at).toBeGreaterThanOrEqual(initialAccessedAt);
  });
});
