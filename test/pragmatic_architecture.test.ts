import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { calculateRecencyScore } from "../src/engine/hybrid.ts";

describe("Mnemosyne Pragmatic 6-Pillar Architecture", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  describe("1. Retrieval Murah Dulu: BM25/FTS5 First, Vector Fallback", () => {
    test("retrieves factual matches purely via FTS5/BM25 fast path", async () => {
      await engine.remember({
        content: "Albatross Gateway routes traffic to local model providers",
        category: "architecture",
        scope: "global",
      });

      // Recall with explicit prefer_bm25 fast path
      const res = await engine.recall({
        query: "Albatross Gateway",
        prefer_bm25: true,
      });

      expect(res.memories.length).toBeGreaterThan(0);
      expect(res.memories[0].content).toContain("Albatross Gateway");
      expect(res.memories[0].bm25_score).toBeGreaterThan(0);
      // Vector score should be 0 because vector calculation was bypassed
      expect(res.memories[0].vector_score).toBe(0);
    });
  });

  describe("2. Extraction + Update/Delete, Bukan Append Dobel", () => {
    test("repeated fact upserts reinforce without duplicate store bloat (5x 'Dek suka americano')", async () => {
      // Run 5 times: "Dek suka americano"
      for (let i = 0; i < 5; i++) {
        const res = await engine.upsertFact({
          subject: "Dek",
          predicate: "SUKA",
          object: "americano",
          category: "preference",
        });

        if (i === 0) {
          expect(res.action).toBe("inserted");
        } else {
          expect(res.action).toBe("reinforced");
        }
      }

      // Verify active triples and memories count is strictly 1 (NOT 5!)
      const activeTriples = db.query("SELECT COUNT(*) as count FROM entity_triples WHERE is_active = 1").get() as any;
      const activeMemories = db.query("SELECT COUNT(*) as count FROM memories WHERE is_active = 1").get() as any;
      expect(activeTriples.count).toBe(1);
      expect(activeMemories.count).toBe(1);

      // Verify access count incremented to 4 (reinforced 4 times after initial insert)
      const mem = db.query("SELECT access_count FROM memories WHERE is_active = 1").get() as any;
      expect(mem.access_count).toBe(4);

      // Value update: "Dek suka latte"
      const updateRes = await engine.upsertFact({
        subject: "Dek",
        predicate: "SUKA",
        object: "latte",
        category: "preference",
      });

      expect(updateRes.action).toBe("updated");
      expect(updateRes.previous_object).toBe("americano");
      expect(updateRes.object).toBe("latte");

      // Active count should still be 1 (old one superseded)
      const activeAfterUpdate = db.query("SELECT COUNT(*) as count FROM entity_triples WHERE is_active = 1").get() as any;
      expect(activeAfterUpdate.count).toBe(1);
    });
  });

  describe("3. Layering: Standing Card (Fast Path) vs Notes (Slow Path)", () => {
    test("retrieves zero-overhead standing facts card without LLM or vector latency", async () => {
      await engine.upsertFact({ subject: "Dek", predicate: "SUKA", object: "americano", category: "preference" });
      await engine.upsertFact({ subject: "Server", predicate: "RUNS_ON", object: "Bun port 8788", category: "hardware" });

      const card = engine.getCard();
      expect(card.facts.length).toBe(2);
      expect(card.formatted).toContain("### 📇 STANDING FACTS CARD");
      expect(card.formatted).toContain("Dek likes americano");
      expect(card.formatted).toContain("Server runs on Bun port 8788");
      expect(card.token_count).toBeLessThan(100);
    });
  });

  describe("4. Budget-Aware Injection & Category Decay", () => {
    test("differentiates stable preference facts vs transient task progress decay", () => {
      const now = Date.now();
      const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;

      // Stable preference (180 days half-life)
      const stableScore = calculateRecencyScore(tenDaysAgo, undefined, "preference");

      // Temporal task progress (1 day half-life)
      const temporalScore = calculateRecencyScore(tenDaysAgo, undefined, "task_progress");

      // Stable fact retains ~96% score, while temporal fact has decayed to near 0 (< 0.001)
      expect(stableScore).toBeGreaterThan(0.9);
      expect(temporalScore).toBeLessThan(0.01);
    });

    test("separates declarative facts from imperative instructions", async () => {
      // Declarative fact
      const id1 = await engine.remember({
        content: "Dek suka kopi hitam tanpa gula",
        category: "preference",
      });

      // Imperative instruction / negative constraint
      const id2 = await engine.remember({
        content: "Dilarang mematikan proxy port 8787 saat test",
        is_negative_constraint: true,
      });

      const mem1 = db.query("SELECT memory_type FROM memories WHERE id = ?").get(id1) as any;
      const mem2 = db.query("SELECT memory_type FROM memories WHERE id = ?").get(id2) as any;

      expect(mem1.memory_type).toBe("declarative");
      expect(mem2.memory_type).toBe("imperative");
    });
  });

  describe("5. Provenance + PII Delete by Source", () => {
    test("bulk deletes memories by source_session and peer", async () => {
      await engine.remember({
        content: "User entered confidential API key XYZ-123 in temporary session",
        source_session: "session-temp-99",
        peer: "external-client",
      });

      await engine.remember({
        content: "Permanent architectural convention for project",
        source_session: "session-main",
        peer: "user",
      });

      const initialCount = (db.query("SELECT COUNT(*) as count FROM memories WHERE is_active = 1").get() as any).count;
      expect(initialCount).toBe(2);

      // Purge by source session
      const deleteRes = engine.deleteBySource({ source_session: "session-temp-99" });
      expect(deleteRes.memories_deleted).toBe(1);

      const remainingCount = (db.query("SELECT COUNT(*) as count FROM memories WHERE is_active = 1").get() as any).count;
      expect(remainingCount).toBe(1);

      // Verify event ledger recorded PURGED
      const events = db.query("SELECT * FROM memory_events WHERE event_type = 'PURGED'").all() as any[];
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("6. Conflict Resolution (Honcho Self-Healing)", () => {
    test("detects opposite polarity contradiction and heals by recency ('Dek suka gaul' vs 'Dek benci gaul')", async () => {
      // 1. Initial fact
      const f1 = await engine.upsertFact({
        subject: "Dek",
        predicate: "SUKA",
        object: "gaul",
      });
      expect(f1.action).toBe("inserted");

      // 2. Direct contradiction arrives
      const f2 = await engine.upsertFact({
        subject: "Dek",
        predicate: "BENCI",
        object: "gaul",
      });

      expect(f2.action).toBe("superseded");
      expect(f2.contradiction_resolved).toBe(true);

      // 3. Verify standing card only shows the winning latest truth
      const card = engine.getCard();
      expect(card.formatted).toContain("Dek dislikes gaul");
      expect(card.formatted).not.toContain("Dek likes gaul");

      // 4. Verify old memory was superseded and marked with contradiction_count = 1
      const oldMem = db.query("SELECT is_active, contradiction_count, superseded_by_id FROM memories WHERE id = ?").get(f1.memory_id) as any;
      expect(oldMem.is_active).toBe(0);
      expect(oldMem.contradiction_count).toBe(1);
      expect(oldMem.superseded_by_id).toBeDefined();
    });
  });
});
