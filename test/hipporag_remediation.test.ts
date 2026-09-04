import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";

describe("Mnemosyne SOTA: HippoRAG, Reflexion & Generative Reflections", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  test("Reflexion playbooks: retrieves exact root cause and shell fix steps for error triggers", () => {
    const remedies = engine.getRemedies("401 unauthorized client detected");
    expect(remedies.length).toBeGreaterThan(0);
    expect(remedies[0].problem_summary).toContain("401 unauthorized");
    expect(remedies[0].root_cause).toContain("stale");
    expect(remedies[0].fix_steps.length).toBeGreaterThan(2);
    expect(remedies[0].fix_steps[1]).toContain("pkill -f agentrouter-proxy.mjs");
  });

  test("Recall attaches automated remediation playbook when query mentions error", async () => {
    const res = await engine.recall({
      query: "Kenapa proxy 401 unauthorized?",
    });

    expect(res.remediations).toBeDefined();
    expect(res.remediations!.length).toBeGreaterThan(0);
    expect(res.formatted).toContain("Automated Remediation Playbook");
    expect(res.formatted).toContain("pkill -f agentrouter-proxy.mjs");
  });

  test("HippoRAG: Personalized PageRank boosts multi-hop connected concepts", async () => {
    // Node 1: Albatross Gateway
    const m1 = await engine.remember({
      content: "Albatross Gateway connects to foundation models",
      scope: "project",
    });

    // Node 2: Bun runtime
    const m2 = await engine.remember({
      content: "Bun runtime provides native high-speed SQLite",
      scope: "project",
    });

    // Node 3: SQLite WAL
    const m3 = await engine.remember({
      content: "SQLite WAL provides concurrent non-blocking reads and writes",
      scope: "project",
    });

    // Create 2-hop link: m1 <-> m2 and m2 <-> m3
    db.prepare(`
      INSERT INTO associative_links (source_id, target_id, resonance_weight, co_occurrences, last_linked_at)
      VALUES (?, ?, 0.9, 5, ?), (?, ?, 0.9, 5, ?)
    `).run(m1, m2, Date.now(), m2, m3, Date.now());

    // Recall specifically for Albatross Gateway with HippoRAG
    const res = await engine.recall({
      query: "Albatross Gateway",
      enable_hipporag: true,
      limit: 5,
    });

    const ids = res.memories.map((m) => m.id);
    expect(ids).toContain(m1);
    expect(ids).toContain(m2);
    // Multi-hop m3 should also be pulled into conscious recall via graph centrality!
    expect(ids).toContain(m3);
  });

  test("Generative Reflection: synthesizes thematic abstraction from atomic facts", async () => {
    await engine.remember({
      content: "Albatross uses SQLite WAL for zero-latency storage",
      category: "architecture",
    });

    await engine.remember({
      content: "Albatross in-flight guardrail masks Indonesian NIK",
      category: "rule",
    });

    const reflection = engine.reflect("Albatross");
    expect(reflection).toBeDefined();
    expect(reflection!.topic).toBe("Albatross");
    expect(reflection!.abstraction).toContain("Thematic Synthesis");
    expect(reflection!.source_memory_ids.length).toBeGreaterThanOrEqual(2);

    const saved = engine.getReflections("Albatross");
    expect(saved.length).toBe(1);
    expect(saved[0].topic).toBe("Albatross");
  });
});
