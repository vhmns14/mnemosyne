import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { 
  exportVault, importVault, syncVault, 
  serializeFrontmatter, parseFrontmatter 
} from "../src/engine/vault.ts";

describe("Mnemosyne Fase 10: Markdown Vault Mirror & Obsidian Bridge Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;
  let tempVaultDir: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);

    tempVaultDir = path.join(os.tmpdir(), `mnemo_vault_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tempVaultDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempVaultDir)) {
        fs.rmSync(tempVaultDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  test("Frontmatter Serializer & Parser: round-trip fidelity", () => {
    const originalMeta = {
      id: "mem-test-123",
      scope: "project" as const,
      category: "rule" as const,
      importance: "critical" as const,
      structure_type: "freeform" as const,
      tags: ["ram", "build", "safeguard"],
      is_negative_constraint: true,
      outcome: "neutral" as const,
      valid_from: 1725500000000,
      valid_until: 1726000000000,
      created_at: 1725500000000,
      updated_at: 1725500000000,
    };

    const content = "Never execute opennextjs-cloudflare build locally on 16GB RAM laptop.";
    const serialized = serializeFrontmatter(originalMeta, content);

    expect(serialized).toContain('id: "mem-test-123"');
    expect(serialized).toContain("is_negative_constraint: true");
    expect(serialized).toContain('- "ram"');
    expect(serialized).toContain('- "build"');

    const parsed = parseFrontmatter(serialized);
    expect(parsed.meta.id).toBe("mem-test-123");
    expect(parsed.meta.scope).toBe("project");
    expect(parsed.meta.category).toBe("rule");
    expect(parsed.meta.importance).toBe("critical");
    expect(parsed.meta.is_negative_constraint).toBe(true);
    expect(parsed.meta.tags).toEqual(["ram", "build", "safeguard"]);
    expect(parsed.content).toBe(content);
  });

  test("exportVault: exports memories organized into category folders", async () => {
    // Seed database with memories
    await engine.remember({
      content: "Never run heavy background builds with nohup or &",
      category: "rule",
      importance: "critical",
      is_negative_constraint: true,
      tags: ["firewall", "background"],
    });

    await engine.remember({
      content: "Postgres database runs on port 5432 and Albatross on 8787",
      category: "architecture",
      importance: "high",
      tags: ["ports", "services"],
    });

    await engine.remember({
      content: "User prefers concise technical responses in Indonesian",
      category: "preference",
      importance: "normal",
      tags: ["user", "language"],
    });

    const exportRes = exportVault(db, tempVaultDir);
    expect(exportRes.total_exported).toBe(3);
    expect(exportRes.by_category["rules"]).toBe(1);
    expect(exportRes.by_category["architecture"]).toBe(1);
    expect(exportRes.by_category["preferences"]).toBe(1);

    // Verify files exist on disk
    expect(fs.existsSync(path.join(tempVaultDir, "rules"))).toBe(true);
    expect(fs.existsSync(path.join(tempVaultDir, "architecture"))).toBe(true);
    expect(fs.existsSync(path.join(tempVaultDir, "preferences"))).toBe(true);
    expect(fs.existsSync(path.join(tempVaultDir, "README.md"))).toBe(true);

    const ruleFiles = fs.readdirSync(path.join(tempVaultDir, "rules"));
    expect(ruleFiles.length).toBe(1);
    expect(ruleFiles[0].endsWith(".md")).toBe(true);

    const fileContent = fs.readFileSync(path.join(tempVaultDir, "rules", ruleFiles[0]), "utf-8");
    expect(fileContent).toContain("Never run heavy background builds");
    expect(fileContent).toContain("is_negative_constraint: true");
  });

  test("importVault: reads markdown files and inserts/updates into SQLite", async () => {
    const factsDir = path.join(tempVaultDir, "facts");
    fs.mkdirSync(factsDir, { recursive: true });

    const mdContent = `---
id: "mem-custom-obsidian"
scope: "global"
category: "fact"
importance: "high"
tags:
  - "manual"
  - "obsidian"
is_negative_constraint: false
---
This fact was authored directly inside Obsidian editor.
`;

    fs.writeFileSync(path.join(factsDir, "obsidian-note.md"), mdContent, "utf-8");

    const importRes = await importVault(db, tempVaultDir);
    expect(importRes.added).toBe(1);
    expect(importRes.total_scanned).toBe(1);

    // Verify memory was inserted into SQLite and is retrievable via hybrid recall
    const recalled = await engine.recall({ query: "Obsidian editor authored" });
    expect(recalled.memories.length).toBeGreaterThan(0);
    expect(recalled.memories[0].content).toContain("This fact was authored directly inside Obsidian");
    expect(recalled.memories[0].tags).toContain("obsidian");
  });

  test("syncVault: bi-directional reconciliation", async () => {
    // 1. Add memory to SQLite
    await engine.remember({
      content: "Initial database memory for sync verification",
      category: "fact",
    });

    // 2. Run sync
    const syncRes = await syncVault(db, tempVaultDir);
    expect(syncRes.exported).toBe(1);

    // 3. Author a new file in vault
    const rulesDir = path.join(tempVaultDir, "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir, "new-rule.md"),
      serializeFrontmatter(
        {
          id: "mem-synced-rule",
          scope: "project",
          category: "rule",
          is_negative_constraint: true,
          tags: ["sync"],
        },
        "Always test before committing changes."
      ),
      "utf-8"
    );

    // 4. Run sync again
    const syncRes2 = await syncVault(db, tempVaultDir);
    expect(syncRes2.imported).toBe(1);
    expect(syncRes2.exported).toBe(2);

    const check = db.query("SELECT id, content FROM memories WHERE id = 'mem-synced-rule'").get() as any;
    expect(check).toBeDefined();
    expect(check.content).toBe("Always test before committing changes.");
  });
});
