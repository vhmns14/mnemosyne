import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { CONFIG } from "../src/config.ts";
import { computeFingerprint } from "../src/engine/dialectic.ts";

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

  test("6. computeFingerprint preserves word order and distinguishes permutations", async () => {
    // Direct unit check on fingerprint hash
    const fpA = computeFingerprint("User prefers A over B");
    const fpB = computeFingerprint("User prefers B over A");
    expect(fpA).not.toBe(fpB);

    // Whitespace and punctuation variations should still match
    const fpBase = computeFingerprint("Dek suka americano.");
    const fpVariant = computeFingerprint("  dek   suka   americano!  ");
    expect(fpBase).toBe(fpVariant);

    // End-to-end remember deduplication check:
    // Adding "User prefers A over B" creates memory 1
    const idA = await engine.remember({
      content: "User prefers A over B",
      category: "preference",
    });

    // Adding identical statement with spacing/casing difference deduplicates to idA
    const idADup = await engine.remember({
      content: "  user prefers a over b!  ",
      category: "preference",
    });
    expect(idADup).toBe(idA);

    // Adding permuted statement "User prefers B over A" MUST NOT be swallowed by fast-path
    const idB = await engine.remember({
      content: "User prefers B over A",
      category: "preference",
    });
    expect(idB).not.toBe(idA);

    // Both memories are preserved in database
    const rowA = db.query("SELECT id, content, is_active FROM memories WHERE id = ?").get(idA) as any;
    const rowB = db.query("SELECT id, content, is_active FROM memories WHERE id = ?").get(idB) as any;
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowB.content).toBe("User prefers B over A");
  });

  test("7. Negation detection prevents false deduplication and separates polarities", async () => {
    const fpAffirm = computeFingerprint("User likes dark mode");
    const fpNegatedEn = computeFingerprint("User does not like dark mode");
    const fpNegatedId = computeFingerprint("User tidak suka dark mode");

    expect(fpAffirm).not.toBe(fpNegatedEn);
    expect(fpAffirm).not.toBe(fpNegatedId);

    // Store positive preference
    const idPos = await engine.remember({
      content: "User likes dark mode",
      category: "preference",
    });

    // Store negative preference (with does not like)
    const idNeg = await engine.remember({
      content: "User does not like dark mode",
      category: "preference",
    });

    // Must not be swallowed by deduplication
    expect(idNeg).not.toBe(idPos);

    // Verify negative constraint auto-detection on imperative anti-patterns
    const negRuleId = await engine.remember({
      content: "Jangan compile binary di background jika RAM < 16GB",
      category: "rule",
    });
    const rowRule = db.query("SELECT is_negative_constraint, memory_type FROM memories WHERE id = ?").get(negRuleId) as any;
    expect(rowRule.is_negative_constraint).toBe(1);
    expect(rowRule.memory_type).toBe("imperative");
  });

  test("8. Declarative negation conflicts supersede opposing positive preferences", async () => {
    // 1st statement: User likes cilantro
    const id1 = await engine.remember({
      content: "User likes cilantro",
      category: "preference",
    });

    let row1 = db.query("SELECT is_active, status FROM memories WHERE id = ?").get(id1) as any;
    expect(row1.is_active).toBe(1);

    // 2nd statement: User does not like cilantro (negation mapped to DISLIKES)
    const id2 = await engine.remember({
      content: "User does not like cilantro",
      category: "preference",
    });

    expect(id2).not.toBe(id1);

    // Opposing triple triggers conflict resolution
    row1 = db.query("SELECT is_active, status, superseded_by_id FROM memories WHERE id = ?").get(id1) as any;
    expect(row1.is_active).toBe(0);
    expect(row1.status).toBe("superseded");
    expect(row1.superseded_by_id).toBe(id2);
  });

  test("9. SQLite FTS5 automatic triggers keep lexical search in sync for raw SQL operations", async () => {
    // 1. Test raw SQL INSERT
    const rawId = "raw-mem-fts-test-1";
    db.prepare(`
      INSERT INTO memories (
        id, content, scope, category, importance, structure_type, tags,
        access_count, last_accessed_at, created_at, updated_at,
        superseded_by_id, is_active, valid_from, valid_until, outcome,
        is_negative_constraint, peer, status, confidence
      ) VALUES (?, 'Archival secret telemetry token xyz789', 'global', 'fact', 'normal', 'freeform', '["#secret"]', 0, 0, 0, 0, NULL, 1, 0, NULL, 'neutral', 0, 'system', 'active', 1.0)
    `).run(rawId);

    // Verify FTS5 virtual table was automatically populated via trigger
    const ftsMatch = db.query("SELECT memory_id, content FROM memory_fts WHERE memory_fts MATCH 'xyz789'").get() as any;
    expect(ftsMatch).toBeDefined();
    expect(ftsMatch.memory_id).toBe(rawId);

    // 2. Test raw SQL UPDATE
    db.prepare("UPDATE memories SET content = 'Archival secret telemetry token updated999' WHERE id = ?").run(rawId);
    const ftsOld = db.query("SELECT memory_id FROM memory_fts WHERE memory_fts MATCH 'xyz789'").get();
    expect(ftsOld).toBeNull();
    const ftsNew = db.query("SELECT memory_id FROM memory_fts WHERE memory_fts MATCH 'updated999'").get() as any;
    expect(ftsNew).toBeDefined();
    expect(ftsNew.memory_id).toBe(rawId);

    // 3. Test raw SQL DELETE
    db.prepare("DELETE FROM memories WHERE id = ?").run(rawId);
    const ftsAfterDel = db.query("SELECT memory_id FROM memory_fts WHERE memory_fts MATCH 'updated999'").get();
    expect(ftsAfterDel).toBeNull();
  });
});
