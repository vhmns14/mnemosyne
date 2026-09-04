import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Mnemosyne Cognitive Expansion: 6 Core Next-Gen Capabilities", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  describe("1. Pre-Flight Agent Firewall & Shell Interceptor", () => {
    test("blocks local builds in undangan-digital (16GB RAM safeguard)", async () => {
      const verdict = await engine.preflight("opennextjs-cloudflare build", {
        contextPath: "/projects/undangan-digital",
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.risk_level).toBe("blocked");
      expect(verdict.matched_rule).toBe("RAM_SAFEGUARD_UNDANGAN_DIGITAL");
      expect(verdict.blocked_reason).toContain("Cloudflare Workers Builds");
    });

    test("blocks background heavy execution with ampersand or nohup", async () => {
      const verdict = await engine.preflight("next build &", {
        contextPath: "/some/project",
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.risk_level).toBe("blocked");
      expect(verdict.matched_rule).toBe("RAM_SAFEGUARD_BACKGROUND_BUILD");
    });

    test("blocks git staging of database files", async () => {
      const verdict1 = await engine.preflight("git add app.db");
      expect(verdict1.allowed).toBe(false);
      expect(verdict1.risk_level).toBe("blocked");
      expect(verdict1.matched_rule).toBe("HYGIENE_DATABASE_FILES_GIT");

      const verdict2 = await engine.preflight("git add data.db-wal");
      expect(verdict2.allowed).toBe(false);
      expect(verdict2.risk_level).toBe("blocked");
      expect(verdict2.matched_rule).toBe("HYGIENE_DATABASE_FILES_GIT");
    });

    test("blocks actions violating dynamic negative constraints stored in memory", async () => {
      await engine.remember({
        content: "Dilarang menjalankan docker rm -f pada container production-db",
        is_negative_constraint: true,
        importance: "critical",
        scope: "global",
      });

      const verdict = await engine.preflight("docker rm -f production-db");
      expect(verdict.allowed).toBe(false);
      expect(verdict.risk_level).toBe("blocked");
      expect(verdict.matched_rule).toBe("DYNAMIC_NEGATIVE_CONSTRAINT");
      expect(verdict.blocked_reason).toContain("docker rm -f");
    });

    test("allows safe foreground commands", async () => {
      const verdict = await engine.preflight("git status");
      expect(verdict.allowed).toBe(true);
      expect(verdict.risk_level).toBe("safe");
    });
  });

  describe("2. Episodic Execution Trajectory & Tool Calibration", () => {
    test("records trajectory and calibrates subsequent tool execution", () => {
      engine.recordTrajectory({
        goal: "Restart agentrouter proxy service via systemd user mode",
        failed_command: "systemctl restart agentrouter-proxy",
        error_snippet: "Failed to connect to bus: No medium found",
        fixed_command: "export XDG_RUNTIME_DIR=/run/user/$(id -u) && systemctl --user restart agentrouter-proxy",
        tool_name: "shell",
      });

      const trajectories = engine.listTrajectories();
      expect(trajectories.length).toBe(1);
      expect(trajectories[0].goal).toContain("agentrouter");

      const calibration = engine.calibrateTool("restart agentrouter proxy systemd user mode");
      expect(calibration.has_match).toBe(true);
      expect(calibration.recommended_command).toContain("export XDG_RUNTIME_DIR");
      expect(calibration.demonstrations.length).toBeGreaterThan(0);
    });
  });

  describe("3. Git-Anchored Staleness Detection", () => {
    test("detects freshness and staleness when target file changes", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mnem-staleness-test-"));
      const testFile = path.join(tmpDir, "config.json");
      fs.writeFileSync(testFile, JSON.stringify({ port: 8080 }));

      const memId = await engine.remember({
        content: "Server default port is 8080 in config.json",
        scope: "project",
      });

      const anchor = engine.anchorMemory(memId, testFile, tmpDir);
      expect(anchor.file_path).toBe("config.json");

      // Initially fresh
      const checkFresh = engine.checkStaleness(memId);
      expect(checkFresh.status).toBe("fresh");

      // Modify file
      fs.writeFileSync(testFile, JSON.stringify({ port: 9090, updated: true }));
      const checkStale = engine.checkStaleness(memId);
      expect(checkStale.status).toBe("stale");

      // Scan workspace
      const report = engine.scanStaleness();
      expect(report.total_anchored).toBe(1);
      expect(report.stale_count).toBe(1);
      expect(report.stale_items[0].memory_id).toBe(memId);

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("4. Autonomous Sleep & Dreamer Pass", () => {
    test("prunes decayed transient memories while strictly preserving negative constraints", async () => {
      // 1. Transient memory with low importance
      const transientId = await engine.remember({
        content: "Temporary build artifact hash cache 99882233",
        importance: "low",
        scope: "session",
      });

      // 2. Critical negative constraint
      const criticalRuleId = await engine.remember({
        content: "JANGAN PERNAH matikan laptop saat update kernel",
        is_negative_constraint: true,
        importance: "critical",
        scope: "global",
      });

      // Backdate transient memory to simulate 45 days age
      const pastTime = Date.now() - 45 * 24 * 60 * 60 * 1000;
      db.prepare(`UPDATE memories SET created_at = ?, updated_at = ?, access_count = 0 WHERE id = ?`).run(pastTime, pastTime, transientId);

      // Run dry-run first
      const dryReport = await engine.dream({ dry_run: true, decay_days: 30 });
      expect(dryReport.pruned_stale_memories).toBe(1);

      // Verify not yet pruned in dry-run
      const stillActive = db.query(`SELECT is_active FROM memories WHERE id = ?`).get(transientId) as any;
      expect(stillActive.is_active).toBe(1);

      // Run live dream pass
      const liveReport = await engine.dream({ dry_run: false, decay_days: 30 });
      expect(liveReport.pruned_stale_memories).toBe(1);

      // Verify transient memory was pruned
      const nowPruned = db.query(`SELECT is_active FROM memories WHERE id = ?`).get(transientId) as any;
      expect(nowPruned.is_active).toBe(0);

      // Verify critical rule is untouched
      const ruleActive = db.query(`SELECT is_active FROM memories WHERE id = ?`).get(criticalRuleId) as any;
      expect(ruleActive.is_active).toBe(1);
    });
  });

  describe("5. Multi-Agent Epistemic Blackboard", () => {
    test("manages multi-agent shared state, versions, and blockers", () => {
      const sessionId = "swarm-task-42";

      // Agent 1 sets hypothesis
      const h1 = engine.blackboard.set(
        sessionId,
        "auth_architecture",
        { strategy: "jwt", provider: "lucia" },
        { stateType: "hypothesis", authorAgentId: "architect-agent" }
      );
      expect(h1.version).toBe(1);
      expect(h1.state_type).toBe("hypothesis");

      // Agent 2 updates to verified fact
      const v1 = engine.blackboard.verifyFact(
        sessionId,
        "auth_architecture",
        { strategy: "jwt", provider: "lucia", verified: true },
        "verifier-agent"
      );
      expect(v1.version).toBe(2);
      expect(v1.state_type).toBe("verified_fact");

      // Agent 3 adds a blocker
      engine.blackboard.addBlocker(
        sessionId,
        "db_migration",
        "Missing foreign key constraint on users table",
        "db-agent"
      );

      // Retrieve single key
      const fetched = engine.blackboard.get(sessionId, "auth_architecture");
      expect(fetched?.state_type).toBe("verified_fact");
      expect(fetched?.version).toBe(2);

      // List all entries in session
      const all = engine.blackboard.list(sessionId);
      expect(all.length).toBe(2);

      // Delete key
      const deleted = engine.blackboard.delete(sessionId, "db_migration");
      expect(deleted).toBe(true);
      expect(engine.blackboard.list(sessionId).length).toBe(1);

      // Clear session
      engine.blackboard.clear(sessionId);
      expect(engine.blackboard.list(sessionId).length).toBe(0);
    });
  });

  describe("6. Dynamic Working Memory L1 Ring Buffer", () => {
    test("caches memories in L1 buffer and invalidates on forget", async () => {
      const memId = await engine.remember({
        content: "Albatross Gateway routes LLM traffic and monitors latency",
        scope: "global",
      });

      engine.cache.clear();

      // First getMemory -> cache miss (hits DB, caches in L1)
      const m1 = engine.getMemory(memId);
      expect(m1).toBeDefined();
      expect(m1?.content).toContain("Albatross Gateway");

      const stats1 = engine.getCacheStats();
      expect(stats1.misses).toBe(1);
      expect(stats1.hits).toBe(0);

      // Second getMemory -> cache hit (retrieved directly from L1 hot cache in < 0.05ms)
      const m2 = engine.getMemory(memId);
      expect(m2).toBeDefined();
      expect(m2?.id).toBe(memId);

      const stats2 = engine.getCacheStats();
      expect(stats2.hits).toBe(1);
      expect(stats2.hit_ratio).toBeGreaterThan(0);

      // Forget memory -> invalidates from L1 cache
      engine.forget(memId);
      const statsAfterForget = engine.getCacheStats();
      expect(statsAfterForget.size).toBe(0);

      const m3 = engine.getMemory(memId);
      expect(m3).toBeNull();
    });
  });
});
