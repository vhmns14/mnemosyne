import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";

describe("Mnemosyne Hybrid Retrieval", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(async () => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);

    // Seed several memories
    await engine.remember({
      content: "Albatross Gateway uses Bun and SQLite WAL on port 8787",
      scope: "project",
      category: "architecture",
    });

    await engine.remember({
      content: "Undangan digital harus deploy di Cloudflare Workers build, bukan lokal",
      scope: "project",
      category: "rule",
      importance: "high",
    });

    await engine.remember({
      content: "User suka makan soto betawi di Senopati",
      scope: "global",
      category: "preference",
    });
  });

  test("recalls relevant technical rule using hybrid query", async () => {
    const res = await engine.recall({
      query: "Cloudflare Workers deploy undangan digital",
      scope: "project",
    });

    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories[0].content).toContain("Cloudflare Workers");
  });

  test("formats output in macro, meso, and micro resolutions", async () => {
    const macroRes = await engine.recall({
      query: "gateway",
      resolution: "macro",
    });
    expect(macroRes.formatted).toContain("USER PROFILE");
    expect(macroRes.formatted).toContain("Albatross Gateway");

    const mesoRes = await engine.recall({
      query: "gateway",
      resolution: "meso",
    });
    expect(mesoRes.formatted).toContain("Recalled Context");

    const microRes = await engine.recall({
      query: "gateway",
      resolution: "micro",
    });
    expect(microRes.formatted).toContain('"signals"');
  });
});
