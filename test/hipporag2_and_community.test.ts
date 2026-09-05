import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { computeHippoPageRank, isInformativeEntity } from "../src/engine/hipporag.ts";
import { detectAndSummarizeCommunities, getCommunitySummaries } from "../src/engine/community.ts";

describe("Mnemosyne Fase 12: HippoRAG 2 Heterogeneous Graph & Community Summaries Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  test("Recognition Memory Gating: filters stopwords & generic tokens", () => {
    expect(isInformativeEntity("the")).toBe(false);
    expect(isInformativeEntity("is")).toBe(false);
    expect(isInformativeEntity("data")).toBe(false);
    expect(isInformativeEntity("thing")).toBe(false);
    expect(isInformativeEntity("ini")).toBe(false);

    // Genuine informative entities pass
    expect(isInformativeEntity("PostgreSQL")).toBe(true);
    expect(isInformativeEntity("Albatross")).toBe(true);
    expect(isInformativeEntity("Cloudflare")).toBe(true);
    expect(isInformativeEntity("SQLite")).toBe(true);
  });

  test("HippoRAG 2: Heterogeneous Bipartite Graph discovers multi-hop passages via shared entities", async () => {
    // Memory 1: Albatross gateway
    const m1 = await engine.remember({
      content: "Albatross gateway forwards incoming client requests to port 8787",
      category: "architecture",
      tags: ["gateway", "proxy"],
    });

    // Memory 2: Port 8787 security
    const m2 = await engine.remember({
      content: "Services on port 8787 authenticate using RS256 JWT tokens",
      category: "architecture",
      tags: ["security", "auth"],
    });

    // Memory 3: Unrelated noise
    await engine.remember({
      content: "Vite dev server runs with HMR on port 5173",
      category: "fact",
    });

    // Query specifically for Albatross gateway
    const recallRes = await engine.recall({
      query: "Albatross gateway",
      limit: 5,
      enable_hipporag: true,
    });

    expect(recallRes.memories.length).toBeGreaterThan(0);
    const topMem = recallRes.memories[0];
    expect(topMem.content).toContain("Albatross gateway");
    expect(topMem.pagerank_score).toBeDefined();

    // Verify entity triples attached
    expect(topMem.connected_entities).toBeDefined();
  });

  test("Community Summaries: partitions active knowledge graph and generates summaries", async () => {
    // Cluster 1: Database & Persistence
    await engine.remember({
      content: "PostgreSQL database handles primary transactional records",
      category: "architecture",
      tags: ["postgres", "database"],
    });
    await engine.remember({
      content: "PostgreSQL database connection pool is set to 20 clients",
      category: "architecture",
      tags: ["postgres", "pooling"],
    });

    // Cluster 2: Guardrails & Hardware Limits
    await engine.remember({
      content: "Laptop RAM is strictly 16GB, avoid local heavy builds",
      category: "rule",
      is_negative_constraint: true,
      importance: "critical",
      tags: ["ram", "hardware"],
    });
    await engine.remember({
      content: "Do not execute background tasks with & or nohup",
      category: "rule",
      is_negative_constraint: true,
      importance: "critical",
      tags: ["ram", "background"],
    });

    // Detect and summarize communities
    const summaries = detectAndSummarizeCommunities(db);
    expect(summaries.length).toBeGreaterThanOrEqual(1);

    for (const comm of summaries) {
      expect(comm.community_id).toBeDefined();
      expect(comm.label.length).toBeGreaterThan(3);
      expect(comm.summary.length).toBeGreaterThan(10);
      expect(comm.member_memory_ids.length).toBeGreaterThan(0);
    }

    // Verify retrieval via getCommunitySummaries
    const fetched = getCommunitySummaries(db);
    expect(fetched.length).toBe(summaries.length);
  });
});
