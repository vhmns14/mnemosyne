import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";

describe("Mnemosyne Advanced SOTA Second Memory Features", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  test("Bi-temporal validity: filters out expired memories unless requested (Zep/Graphiti style)", async () => {
    const pastTime = Date.now() - 1000 * 60 * 60 * 24; // 1 day ago

    // Expired sprint task
    await engine.remember({
      content: "Sprint 1: Deploy test endpoint",
      valid_until: pastTime,
    });

    // Active long-term fact
    await engine.remember({
      content: "Production endpoint is hosted on Cloudflare",
    });

    // Default recall should only return active fact
    const res = await engine.recall({ query: "endpoint" });
    expect(res.memories.length).toBe(1);
    expect(res.memories[0].content).toContain("Cloudflare");

    // Recall with include_expired should return both
    const resExpired = await engine.recall({ query: "endpoint", include_expired: true });
    expect(resExpired.memories.length).toBe(2);
  });

  test("Negative constraints: strictly prepended and alerted (Supermemory style)", async () => {
    await engine.remember({
      content: "DILARANG jalankan background build untuk next.js di laptop RAM 16GB",
      is_negative_constraint: true,
      category: "negative_constraint",
    });

    await engine.remember({
      content: "Cara build NextJS adalah menggunakan perintah bun build",
      category: "fact",
    });

    const res = await engine.recall({ query: "build next.js" });
    expect(res.formatted).toContain("Critical Negative Constraints");
    expect(res.formatted).toContain("DILARANG jalankan background build");
  });

  test("Past failure retrospectives: warns agent about historical pitfalls (LangMem style)", async () => {
    await engine.remember({
      content: "Proxy gagal 401 unauthorized karena proses node lama basi masih jalan di port 8787",
      outcome: "failure",
      failure_reason: "Stale node process on port 8787",
    });

    const res = await engine.recall({ query: "proxy 401 port 8787" });
    expect(res.formatted).toContain("Past Failure Lessons");
    expect(res.formatted).toContain("Reason: Stale node process");
  });

  test("Entity resolution: maps aliases to canonical names (Cognee style)", async () => {
    await engine.remember({
      content: "albatross-gateway handles high throughput LLM routing",
    });

    // Register alias: "gw" -> "albatross-gateway"
    engine.addAlias("gw", "albatross-gateway");

    // Search using alias "gw"
    const res = await engine.recall({ query: "gw throughput" });
    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories[0].content).toContain("albatross-gateway");
  });

  test("Memory consolidation pass: cleans up expired records and strengthens links (MemGPT style)", async () => {
    const expiredTime = Date.now() - 5000;
    await engine.remember({
      content: "Temporary cache token expires in 5s",
      valid_until: expiredTime,
    });

    const report = engine.consolidate();
    expect(report.pruned_memories).toBeGreaterThanOrEqual(1);

    // Expired memory should now be marked inactive
    const activeMems = db.query("SELECT * FROM memories WHERE is_active = 1").all();
    expect(activeMems.length).toBe(0);
  });
});
