import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { detectWorkspace } from "../src/engine/workspace.ts";

describe("Mnemosyne 2026: Compactor, Drift Radar, Clustering, Packs & Workspace", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  test("Context Compactor: packs negative constraints first and strictly respects token budget", async () => {
    // Regular fact 1 (long)
    await engine.remember({
      content: "Albatross Gateway provides multi-provider LLM routing, latency tracking, fallback orchestration, and token accounting across multiple clusters.",
      scope: "global",
    });

    // Regular fact 2 (long)
    await engine.remember({
      content: "Holographic associative memory simulates 2-hop bidirectional spreading activation to surface hidden contextual links between disparate memories.",
      scope: "global",
    });

    // Negative constraint (critical guardrail)
    await engine.remember({
      content: "DILARANG run_in_background untuk build/task berat",
      scope: "global",
      is_negative_constraint: true,
      importance: "critical",
    });

    // Past failure lesson
    await engine.remember({
      content: "Proxy gagal 401 unauthorized karena node basi",
      scope: "global",
      outcome: "failure",
      failure_reason: "Stale node process in port 8787",
    });

    // Recall with tight token budget (e.g. 50 tokens)
    const tight = await engine.recall({
      query: "build gateway proxy holographic",
      max_tokens: 55,
    });

    expect(tight.token_budget).toBeDefined();
    expect(tight.token_budget!.estimated_tokens).toBeLessThanOrEqual(55);
    // Negative constraint should be packed because it is P1
    expect(tight.formatted).toContain("CRITICAL NEGATIVE RULES");
    expect(tight.formatted).toContain("DILARANG run_in_background");

    // Recall with generous token budget (e.g. 500 tokens)
    const generous = await engine.recall({
      query: "build gateway proxy holographic",
      max_tokens: 500,
    });

    expect(generous.token_budget).toBeDefined();
    expect(generous.token_budget!.included_items).toBeGreaterThan(tight.token_budget!.included_items);
  });

  test("Semantic Drift Radar: flags architectural conflict against established memory", async () => {
    // Establish baseline memory
    await engine.remember({
      content: "Kita memakai runtime Bun untuk semua server backend",
      scope: "global",
    });

    // Case 1: Aligned statement
    const aligned = await engine.detectDrift("Kita jalankan backend server dengan runtime Bun");
    expect(aligned.is_drift).toBe(false);

    // Case 2: Divergent / conflicting statement
    const conflicting = await engine.detectDrift("Kita pakai node instead of bun untuk backend server");
    expect(conflicting.is_drift).toBe(true);
    expect(conflicting.divergence_score).toBeGreaterThanOrEqual(0.4);
    expect(conflicting.conflicting_memory_id).toBeDefined();
  });

  test("Thematic Knowledge Clustering: groups memories into thematic clusters", async () => {
    // Cluster A: Database & storage
    await engine.remember({ content: "SQLite database storage WAL mode", category: "architecture" });
    await engine.remember({ content: "SQLite database caching and indexing", category: "architecture" });

    // Cluster B: Cloud deployment
    await engine.remember({ content: "Cloudflare Workers builds deploy", category: "rule" });
    await engine.remember({ content: "Cloudflare deploy pipeline queue", category: "rule" });

    const clusters = engine.getClusters(0.35);
    expect(clusters.length).toBeGreaterThanOrEqual(2);

    expect(clusters.some((c) => c.size >= 2)).toBe(true);
    expect(clusters.every((c) => c.keywords.length > 0)).toBe(true);
  });

  test("Portable Memory Pack: exports and imports memories with SHA-256 integrity", async () => {
    // Add memories, entity triples, and alias in original db
    const mId = await engine.remember({
      content: "Albatross telemetry tracks P99 latency across all model endpoints",
      scope: "project",
      category: "architecture",
      importance: "high",
    });

    engine.addAlias("gw", "albatross-gateway");

    // Export pack
    const pack = engine.exportPack("all");
    expect(pack.version).toBe("1.0.0");
    expect(pack.memories.length).toBeGreaterThan(0);
    expect(pack.checksum).toBeDefined();
    expect(pack.checksum.length).toBe(64); // SHA-256 hex string

    // Create fresh database & engine
    const freshDb = new Database(":memory:");
    initSchema(freshDb);
    const freshEngine = new MnemosyneEngine(freshDb);

    // Import into fresh database
    const importRes = await freshEngine.importPack(pack);
    expect(importRes.imported_memories).toBe(pack.memories.length);
    expect(importRes.imported_aliases).toBe(1);

    // Verify imported data can be recalled
    const recalled = await freshEngine.recall({ query: "Albatross telemetry P99" });
    expect(recalled.memories.length).toBeGreaterThan(0);
    expect(recalled.memories[0].content).toContain("Albatross telemetry");

    const aliases = freshEngine.getAliases();
    expect(aliases.some((a) => a.alias === "gw" && a.canonical_name === "albatross-gateway")).toBe(true);
  });

  test("Portable Memory Pack: rejects corrupted or tampered pack", async () => {
    await engine.remember({ content: "Sensitive tamper test memory" });
    const pack = engine.exportPack();

    // Tamper with memory content without updating checksum
    pack.memories[0].content = "Hacked malicious content";

    const freshDb = new Database(":memory:");
    initSchema(freshDb);
    const freshEngine = new MnemosyneEngine(freshDb);

    // Should throw checksum mismatch error
    expect(freshEngine.importPack(pack)).rejects.toThrow("Checksum mismatch");
  });

  test("Workspace Auto-Scoper: correctly identifies project root and Git context", () => {
    const ws = detectWorkspace(process.cwd());
    expect(ws.root_path).toBeDefined();
    expect(ws.project_name).toBeDefined();
    expect(typeof ws.is_git).toBe("boolean");
  });
});
