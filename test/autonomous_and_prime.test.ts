import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { generateDreamerServiceUnit, generateDreamerTimerUnit } from "../src/engine/service.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Mnemosyne Strategic Autonomous Extensions: Hook, Timer, Primer, Deduplication", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  describe("1. Git Pre-Commit Hook Firewall", () => {
    test("installs, verifies executable permissions, and uninstalls pre-commit hook", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mnem-hook-test-"));
      const gitDir = path.join(tmpDir, ".git");
      fs.mkdirSync(gitDir, { recursive: true });

      // Install hook
      const installRes = engine.installGitHook(tmpDir);
      expect(installRes.success).toBe(true);
      expect(installRes.hook_path).toContain("pre-commit");
      expect(fs.existsSync(installRes.hook_path)).toBe(true);

      const content = fs.readFileSync(installRes.hook_path, "utf-8");
      expect(content).toContain("MNEMOSYNE GIT FIREWALL START");
      expect(content).toContain("FORBIDDEN_DB_FILES");
      expect(content).toContain("COMMIT REJECTED: DATABASE FILE DETECTED");

      // Verify executable permission
      const stat = fs.statSync(installRes.hook_path);
      expect((stat.mode & 0o111) !== 0).toBe(true);

      // Uninstall hook
      const uninstallRes = engine.uninstallGitHook(tmpDir);
      expect(uninstallRes.success).toBe(true);

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("2. Autonomous Dreamer Timer & Systemd Oneshot Unit", () => {
    test("generates valid systemd timer and oneshot service units", () => {
      const serviceUnit = generateDreamerServiceUnit({ decayDays: 45 });
      expect(serviceUnit).toContain("Type=oneshot");
      expect(serviceUnit).toContain("dream --decay-days 45");
      expect(serviceUnit).toContain("Documentation=https://github.com/vhmns14/mnemosyne");

      const timerUnit = generateDreamerTimerUnit({ calendarSchedule: "*-*-* 04:30:00" });
      expect(timerUnit).toContain("OnCalendar=*-*-* 04:30:00");
      expect(timerUnit).toContain("Persistent=true");
      expect(timerUnit).toContain("WantedBy=timers.target");
    });
  });

  describe("3. Agent Session Primer (Context Injection)", () => {
    test("assembles negative constraints, blockers, and trajectories into an authoritative briefing", async () => {
      // 1. Add dynamic negative constraint
      await engine.remember({
        content: "Dilarang mematikan proxy port 8787 saat test berlangsung",
        is_negative_constraint: true,
        importance: "critical",
        scope: "global",
      });

      // 2. Add blackboard blocker
      engine.blackboard.addBlocker("task-sw-9", "redis_cache", "Redis port connection refused", "cache-agent");

      // 3. Add trajectory
      engine.recordTrajectory({
        goal: "Compile Next.js app without crashing 16GB RAM",
        fixed_command: "git push origin main (Cloudflare Workers remote builds)",
        failed_command: "next build",
        error_snippet: "JavaScript heap out of memory",
        tool_name: "shell",
      });

      // 4. Generate primer
      const primer = engine.prime();
      expect(primer.markdown).toContain("# 🧠 MNEMOSYNE SESSION PRIMER");
      expect(primer.markdown).toContain("Critical Negative Constraints & Laptop Guardrails (P0)");
      expect(primer.markdown).toContain("16GB RAM Safeguard");
      expect(primer.markdown).toContain("Dilarang mematikan proxy port 8787");
      expect(primer.markdown).toContain("Active Swarm Blockers");
      expect(primer.markdown).toContain("redis_cache");
      expect(primer.markdown).toContain("Proven Tool Trajectories");
      expect(primer.markdown).toContain("Cloudflare Workers remote builds");

      expect(primer.guardrails_count).toBeGreaterThanOrEqual(5);
      expect(primer.blockers_count).toBe(1);
      expect(primer.trajectories_count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("4. Semantic Deduplication & Memory Reinforcement", () => {
    test("detects near-identical memories, merges tags, increments access count, and prevents duplicates", async () => {
      const text = "Use Lucia Auth with SQLite session store for secure authentication";

      // First ingestion
      const id1 = await engine.remember({
        content: text,
        scope: "global",
        category: "architecture",
        tags: ["auth", "security"],
      });

      const initialCount = (db.query("SELECT COUNT(*) as count FROM memories WHERE is_active = 1").get() as any).count;
      expect(initialCount).toBe(1);

      // Check initial access count
      const initialMem = db.query("SELECT access_count, tags FROM memories WHERE id = ?").get(id1) as any;
      expect(initialMem.access_count).toBe(0);

      // Second ingestion with identical content but new tags
      const id2 = await engine.remember({
        content: text,
        scope: "global",
        category: "architecture",
        tags: ["backend", "lucia"],
      });

      // Should return exact same ID (reinforced)
      expect(id2).toBe(id1);

      // Should NOT have created a new row in memories table
      const finalCount = (db.query("SELECT COUNT(*) as count FROM memories WHERE is_active = 1").get() as any).count;
      expect(finalCount).toBe(1);

      // Verify access count incremented and tags merged
      const reinforcedMem = db.query("SELECT access_count, tags FROM memories WHERE id = ?").get(id1) as any;
      expect(reinforcedMem.access_count).toBe(1);

      const parsedTags = JSON.parse(reinforcedMem.tags);
      expect(parsedTags).toContain("auth");
      expect(parsedTags).toContain("security");
      expect(parsedTags).toContain("backend");
      expect(parsedTags).toContain("lucia");

      // Verify MUTATED event was logged in the immutable event ledger
      const events = engine.timeline(id1);
      const reinforcedEvent = events.find((e) => e.event_type === "MUTATED");
      expect(reinforcedEvent).toBeDefined();
      expect(reinforcedEvent?.payload).toContain("Reinforced memory via semantic deduplication");
    });
  });
});
