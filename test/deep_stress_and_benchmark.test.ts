import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";

describe("Mnemosyne Deep Stress Test & 2026 MemoryAgentBench Protocol", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  test("MemoryAgentBench Competency 1: Accurate signal retrieval amidst 50 distracting noise items", async () => {
    // Inject 50 distractor memories
    for (let i = 0; i < 50; i++) {
      await engine.remember({
        content: `Random distractor factual statement number ${i} regarding unrelated topics in astronomy, biology, and chemistry.`,
        scope: "global",
      });
    }

    // Target memory
    const targetId = await engine.remember({
      content: "Albatross Gateway uses Groq LPU as Tier-1 primary upstream router with sub-15ms failover",
      scope: "project",
      category: "architecture",
      importance: "high",
    });

    const start = performance.now();
    const res = await engine.recall({
      query: "Groq LPU upstream router failover",
      limit: 3,
    });
    const duration = performance.now() - start;

    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories[0].id).toBe(targetId);
    expect(res.memories[0].content).toContain("Groq LPU");
    expect(duration).toBeLessThan(50); // Under 50ms even with 50+ vector & FTS scans
  });

  test("MemoryAgentBench Competency 2: Test-Time Learning & Conflict Invalidation", async () => {
    const memV1 = await engine.remember({
      content: "Port Gateway diatur ke 8080 untuk development",
      scope: "project",
    });

    // Developer updates port to 8787 during execution
    const memV2 = await engine.remember({
      content: "Port Gateway dipindahkan ke 8787 untuk menghindari konflik proxy",
      scope: "project",
      supersedes_query: "8080",
    });

    const res = await engine.recall({ query: "port gateway" });
    const recalledIds = res.memories.map((m) => m.id);

    expect(recalledIds).toContain(memV2);
    expect(recalledIds).not.toContain(memV1); // V1 must be suppressed
  });

  test("MemoryAgentBench Competency 4: Cryptographic Hard Purge with SHA-256 Receipt", async () => {
    const sensitiveId = await engine.remember({
      content: "Sensitive customer token: dummy-synthetic-token-9999",
      category: "fact",
    });

    // Verify it exists initially
    const beforeRecall = await engine.recall({ query: "synthetic-token" });
    expect(beforeRecall.memories.length).toBe(1);

    // Hard purge with cryptographic proof
    const receipt = engine.purge(sensitiveId);
    expect(receipt).toBeDefined();
    expect(receipt!.sha256_hash).toBeDefined();
    expect(receipt!.sha256_hash.length).toBe(64); // Valid SHA-256

    // Verify complete eradication from memory
    const afterRecall = await engine.recall({ query: "synthetic-token" });
    expect(afterRecall.memories.length).toBe(0);

    // Verify permanent audit log entry
    const auditRow = db.query("SELECT * FROM audit_log WHERE target_id = ?").get(sensitiveId) as any;
    expect(auditRow).toBeDefined();
    expect(auditRow.action).toBe("PERMANENT_PURGE");
  });

  test("Letta 2026 Context Doctor: Detects and surgically repairs orphaned triples", async () => {
    // Simulate corruption by disabling foreign keys temporarily
    db.exec("PRAGMA foreign_keys = OFF;");
    db.prepare(`
      INSERT INTO entity_triples (id, subject, predicate, object, memory_id, confidence, is_active, valid_from, valid_until, created_at)
      VALUES ('orphan-1', 'GhostEntity', 'USES', 'Nothing', 'non-existent-id', 1.0, 1, 0, NULL, ?)
    `).run(Date.now());
    db.exec("PRAGMA foreign_keys = ON;");

    // Audit health: Should detect corruption
    const initialReport = engine.doctor(false);
    expect(initialReport.health_score).toBeLessThan(100);
    expect(initialReport.orphaned_triples).toBe(1);

    // Execute automated surgical repair
    const repairReport = engine.doctor(true);
    expect(repairReport.health_score).toBe(100);
    expect(repairReport.repairs_performed.length).toBeGreaterThan(0);

    // Verify orphan was purged
    const checkRow = db.query("SELECT * FROM entity_triples WHERE id = 'orphan-1'").get();
    expect(checkRow).toBeNull();
  });

  test("Mem0 Jan 2026: Immutable Event Ledger & Temporal Lineage", async () => {
    const id = await engine.remember({
      content: "Initial project setup using Vite",
      actor: "user",
    });

    await engine.remember({
      content: "Migrated from Vite to Bun runtime",
      supersedes_query: "Vite",
      actor: "agent",
    });

    const timeline = engine.timeline(id);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline[0].event_type).toBe("CREATED");
    expect(timeline[1].event_type).toBe("SUPERSEDED");
  });

  test("High-Throughput Concurrency Benchmark: 200 rapid writes and batch queries", async () => {
    const start = performance.now();
    const count = 200;

    for (let i = 0; i < count; i++) {
      await engine.remember({
        content: `Benchmark micro-memory entity item_${i} configuration key_${i % 10}`,
        scope: i % 2 === 0 ? "global" : "project",
        category: "fact",
      });
    }

    const writeElapsed = performance.now() - start;
    const writeThroughput = (count / (writeElapsed / 1000)).toFixed(0);

    // Test multi-query batch
    const queryStart = performance.now();
    for (let j = 0; j < 10; j++) {
      await engine.recall({ query: `item_${j * 20}`, limit: 3 });
    }
    const queryElapsed = (performance.now() - queryStart) / 10;

    expect(Number(writeThroughput)).toBeGreaterThan(200); // More than 200 writes/sec in SQLite WAL
    expect(queryElapsed).toBeLessThan(15); // Average query < 15ms
  });
});
