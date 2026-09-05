import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { computeWordDiff, diffMemories } from "../src/engine/diff.ts";
import { getModelBudgetProfile, compactContextAdaptive } from "../src/engine/compactor.ts";

describe("Mnemosyne SOTA 2026 Enhancements Suite", () => {
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
    } catch {
      // ignore
    }
  });

  test("1. Semantic Word-Level LCS Diff Computation", () => {
    const textA = "Albatross runs on port 8787 using Redis cache";
    const textB = "Albatross runs on port 8788 using SQLite WAL";

    const diff = computeWordDiff(textA, textB);
    expect(diff.length).toBeGreaterThan(0);

    const removed = diff.filter((d) => d.type === "removed").map((d) => d.value);
    const added = diff.filter((d) => d.type === "added").map((d) => d.value);

    expect(removed).toContain("8787");
    expect(removed).toContain("Redis");
    expect(added).toContain("8788");
    expect(added).toContain("SQLite");
  });

  test("2. Semantic Time-Travel Memory Diff Between Historical Revisions", async () => {
    // 1. Remember initial architectural fact
    const id1 = await engine.remember({
      content: "Backend uses PostgreSQL on port 5432 with Prisma ORM",
      category: "architecture",
      importance: "normal",
      scope: "project",
    });

    // 2. Invalidate and supersede with updated architecture
    const id2 = await engine.remember({
      content: "Backend uses Bun SQLite WAL mode on disk with Kysely query builder",
      category: "architecture",
      importance: "high",
      scope: "project",
      supersedes_query: "Backend uses PostgreSQL",
    });

    // 3. Diff from id1 (older revision) automatically finds id2 (superseding revision)
    const diff1 = engine.diff(id1);
    expect(diff1.target_a.id).toBe(id1);
    expect(diff1.target_b.id).toBe(id2);
    expect(diff1.field_changes.content_changed).toBe(true);
    expect(diff1.field_changes.importance_changed).toBe(true);
    expect(diff1.formatted).toContain("SEMANTIC MEMORY DIFF");
    expect(diff1.formatted).toContain("- Backend uses PostgreSQL on port 5432 with Prisma ORM");
    expect(diff1.formatted).toContain("+ Backend uses Bun SQLite WAL mode on disk with Kysely query builder");

    // 4. Diff between explicit pairs
    const diffPair = engine.diff(id1, id2);
    expect(diffPair.target_a.content).toContain("PostgreSQL");
    expect(diffPair.target_b.content).toContain("SQLite");
  });

  test("3. Adaptive Model Budget Compactor", async () => {
    // Profiles for various target LLMs
    const claudeProfile = getModelBudgetProfile("claude-3-5-sonnet");
    expect(claudeProfile.model_family).toBe("claude");
    expect(claudeProfile.recommended_memory_budget_tokens).toBe(8000);

    const gptProfile = getModelBudgetProfile("gpt-4o");
    expect(gptProfile.model_family).toBe("gpt4");
    expect(gptProfile.recommended_memory_budget_tokens).toBe(4000);

    const ollamaProfile = getModelBudgetProfile("qwen2.5-coder:7b");
    expect(ollamaProfile.model_family).toBe("ollama");
    expect(ollamaProfile.recommended_memory_budget_tokens).toBe(1200);

    const hermesProfile = getModelBudgetProfile("hermes-3-llama-3.1-8b");
    expect(hermesProfile.model_family).toBe("hermes");
    expect(hermesProfile.recommended_memory_budget_tokens).toBe(2000);

    // Test adaptive compaction
    const mems: any[] = [
      { id: "m1", content: "DILARANG gunakan background tasks", is_negative_constraint: true, outcome: "neutral" },
      { id: "m2", content: "Server listens on 8788", is_negative_constraint: false, outcome: "neutral" },
    ];

    const adapted = engine.compactAdaptive(mems, { model: "ollama" });
    expect(adapted.profile.model_family).toBe("ollama");
    expect(adapted.budget.max_tokens).toBe(1200);
    expect(adapted.formatted).toContain("CRITICAL NEGATIVE RULES");
  });

  test("4. Multi-Agent Epistemic Dispute Arbitration on Blackboard", () => {
    const sessionId = "swarm-task-900";
    const key = "deployment_target";

    // Agent A (lead) claims target is Cloudflare Workers
    engine.blackboard.set(sessionId, key, "Cloudflare Workers", {
      authorAgentId: "lead",
      stateType: "verified_fact",
    });

    // Agent B (worker) submits competing claim (Fly.io)
    const dispute = engine.contestBlackboard(
      sessionId,
      key,
      "Fly.io",
      "worker-2",
      "Benchmarked lower latency on Fly.io"
    );

    expect(dispute.is_disputed).toBe(true);
    expect(dispute.disputing_agents).toContain("lead");
    expect(dispute.disputing_agents).toContain("worker-2");
    expect(dispute.status).toBe("resolved");
    // Authority rule preserves leading agent
    expect(dispute.arbitrated_winner?.agent_id).toBe("lead");
    expect(dispute.arbitrated_winner?.value).toBe("Cloudflare Workers");

    // When worker submits to another worker's key, updated claim prevails
    engine.blackboard.set(sessionId, "cache_store", "Memory", {
      authorAgentId: "worker-1",
      stateType: "hypothesis",
    });

    const dispute2 = engine.contestBlackboard(
      sessionId,
      "cache_store",
      "SQLite WAL L1",
      "worker-2",
      "Benchmarked lower memory"
    );

    expect(dispute2.is_disputed).toBe(true);
    expect(dispute2.arbitrated_winner?.agent_id).toBe("worker-2");
    expect(dispute2.arbitrated_winner?.value).toBe("SQLite WAL L1");
  });
});
