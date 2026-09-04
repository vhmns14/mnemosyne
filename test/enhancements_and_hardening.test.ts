import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { getDefaultBackupDir, createBackup, listBackups } from "../src/engine/backup.ts";
import { extractTriples, isTransactionalNoise, rememberMemory } from "../src/engine/dialectic.ts";
import { runHermesDreamerPass } from "../src/engine/dreamer.ts";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Mnemosyne Production Hardening & Enhancements Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `mnemo-hardening-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    const dbPath = join(testDir, "test.db");
    db = new Database(dbPath);
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  afterEach(() => {
    try {
      db.close();
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test("1. Backup path resolves relative to active DB_PATH", () => {
    const backupDir = getDefaultBackupDir(db.filename);
    expect(backupDir).toBe(join(testDir, "backups"));

    const backupRes = createBackup(db);
    expect(backupRes.success).toBe(true);
    expect(backupRes.backupPath.startsWith(backupDir)).toBe(true);
    expect(existsSync(backupRes.backupPath)).toBe(true);

    const backups = listBackups(undefined, db.filename);
    expect(backups.length).toBe(1);
  });

  test("2. Noise filter accurately detects transactional output", () => {
    expect(isTransactionalNoise("git commit done")).toBe(true);
    expect(isTransactionalNoise("task completed successfully")).toBe(true);
    expect(isTransactionalNoise("running opennextjs-cloudflare build")).toBe(true);
    expect(isTransactionalNoise("Vahmi prefers Fastify over Express")).toBe(false);
    expect(isTransactionalNoise("DILARANG run_in_background untuk task berat di laptop 16GB")).toBe(false);
  });

  test("3. Alias auto-canonicalization from statements and acronyms", async () => {
    // Pattern: 'gw alias albatross-gateway'
    const triples1 = extractTriples("gw alias albatross-gateway");
    expect(triples1.length).toBeGreaterThan(0);
    expect(triples1[0].predicate).toBe("ALIAS_OF");
    expect(triples1[0].subject).toBe("gw");
    expect(triples1[0].object).toBe("albatross-gateway");

    // Ingesting should automatically populate entity_aliases table
    await engine.remember({ content: "gw alias albatross-gateway" });
    const aliases = engine.getAliases();
    const found = aliases.find((a) => a.alias === "gw");
    expect(found).toBeDefined();
    expect(found?.canonical_name).toBe("albatross-gateway");

    // Pattern: 'albatross-gateway (agw)'
    await engine.remember({ content: "albatross-gateway (agw) provides reverse proxy caching" });
    const aliases2 = engine.getAliases();
    const found2 = aliases2.find((a) => a.alias === "agw");
    expect(found2).toBeDefined();
    expect(found2?.canonical_name).toBe("albatross-gateway");
  });

  test("4. Hermes Dreamer runs with offline fallback when LLM is offline or disabled", async () => {
    // Ingest chat notes
    await engine.ingest({ content: "Dek suka matcha", peer: "hermes", is_fact: true });
    await engine.ingest({ content: "Vahmi selalu menggunakan port 8788", peer: "hermes", is_fact: false });

    // Run dreaming pass with use_llm: false (or offline fallback)
    const report = await engine.dreamHermes({ use_llm: false });
    expect(report.input_delta_count).toBe(2);
    expect(report.facts_added).toBeGreaterThanOrEqual(1);
    expect(report.patterns_found).toBeGreaterThanOrEqual(1);

    // Verify patterns table received the habit
    const patterns = db.query("SELECT * FROM patterns").all() as any[];
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].pattern).toContain("8788");
  });

  test("5. Telemetry metrics counts track dreams, evictions, and notes", async () => {
    await engine.ingest({ content: "Test message 1", peer: "user", is_fact: false });
    await engine.dreamHermes({ use_llm: false });

    const stats = engine.getStats();
    expect(stats.notes_count).toBeGreaterThanOrEqual(1);
    expect(stats.dreams_count).toBeGreaterThanOrEqual(1);

    const dreamRows = db.query("SELECT COUNT(*) as c FROM dreams").get() as any;
    expect(dreamRows.c).toBeGreaterThanOrEqual(1);
  });
});
