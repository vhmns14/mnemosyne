import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { createBackup, listBackups, restoreBackup } from "../src/engine/backup.ts";
import { installMcpConfig, checkMcpStatus } from "../src/engine/mcp_config.ts";
import { generateServiceUnit, installSystemService } from "../src/engine/service.ts";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Mnemosyne Operations, Integrations & Last-Mile Tooling Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `mnemo-op-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("Backup & Restore: creates atomic online SQLite snapshot via VACUUM INTO and restores", async () => {
    // 1. Seed some memories
    await engine.remember({
      content: "Atomic snapshot verification fact",
      category: "fact",
    });

    const backupRes = createBackup(db, testDir);
    expect(backupRes.success).toBe(true);
    expect(backupRes.sizeBytes).toBeGreaterThan(0);
    expect(existsSync(backupRes.backupPath)).toBe(true);

    // 2. Verify listBackups sees the file
    const backups = listBackups(testDir);
    expect(backups.length).toBe(1);
    expect(backups[0].filename).toContain("mnemosyne-backup-");

    // 3. Verify restore to a target location
    const restoreTarget = join(testDir, "restored.db");
    const restoreRes = restoreBackup(backupRes.backupPath, restoreTarget);
    expect(restoreRes.success).toBe(true);
    expect(existsSync(restoreTarget)).toBe(true);

    // 4. Open restored DB to verify data survived
    const restoredDb = new Database(restoreTarget);
    const count = restoredDb.query("SELECT count(*) as count FROM memories").get() as any;
    expect(count.count).toBeGreaterThanOrEqual(1);
    restoredDb.close();
  });

  it("MCP Auto-Configurator: writes and updates client configuration without clobbering existing settings", () => {
    const mockConfigPath = join(testDir, "opencode.json");

    // Pre-populate with existing server
    writeFileSync(
      mockConfigPath,
      JSON.stringify({
        mcpServers: {
          existingTool: { command: "node", args: ["server.js"] },
        },
      })
    );

    // 1. Install mnemosyne config
    const installRes = installMcpConfig("opencode", { customPath: mockConfigPath });
    expect(installRes.success).toBe(true);
    expect(installRes.alreadyConfigured).toBe(false);

    // 2. Verify status
    const status = checkMcpStatus("opencode", mockConfigPath);
    expect(status.exists).toBe(true);
    expect(status.isConfigured).toBe(true);
    expect(status.command).toBe("bun");

    // 3. Re-install to test update behavior
    const updateRes = installMcpConfig("opencode", { customPath: mockConfigPath });
    expect(updateRes.success).toBe(true);
    expect(updateRes.alreadyConfigured).toBe(true);

    // 4. Verify existingTool is preserved
    const raw = JSON.parse(readFileSync(mockConfigPath, "utf-8"));
    expect(raw.mcpServers.existingTool).toBeDefined();
    expect(raw.mcpServers.mnemosyne).toBeDefined();
  });

  it("Systemd User Service: generates valid systemd unit file and installs safely", () => {
    const unitContent = generateServiceUnit({
      workingDir: "/tmp/custom-workdir",
      port: 8788,
    });

    expect(unitContent).toContain("[Unit]");
    expect(unitContent).toContain("Description=Mnemosyne Second Memory");
    expect(unitContent).toContain("WorkingDirectory=/tmp/custom-workdir");
    expect(unitContent).toContain("Environment=MNEMO_PORT=8788");
    expect(unitContent).toContain("Restart=always");
    expect(unitContent).toContain("[Install]");

    const customServicePath = join(testDir, "mnemosyne.service");
    const installRes = installSystemService({
      customServicePath,
      enableAndStart: false,
    });

    expect(installRes.success).toBe(true);
    expect(existsSync(customServicePath)).toBe(true);
  });

  it("Hermes Context Retrieval: builds token-compacted system prompt for agent execution", async () => {
    await engine.remember({
      content: "Do not execute playwright screenshots in parallel (RAM 16GB limit)",
      category: "negative_constraint",
      is_negative_constraint: true,
      importance: "critical",
    });

    await engine.remember({
      content: "Deploy frontend directly to Cloudflare Workers Builds",
      category: "architecture",
      importance: "high",
    });

    const recall = await engine.recall({
      query: "How should we deploy and run screenshots?",
      limit: 5,
      max_tokens: 300,
    });

    expect(recall.formatted).toContain("CRITICAL NEGATIVE RULES");
    expect(recall.formatted).toContain("playwright screenshots in parallel");
    expect(recall.token_budget?.estimated_tokens).toBeLessThanOrEqual(300);
  });
});
