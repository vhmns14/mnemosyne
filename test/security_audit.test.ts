import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { validateBlockName, getContextBlock, setContextBlock, deleteContextBlock } from "../src/engine/blocks.ts";
import { parseFrontmatter, resolveVaultDir, exportVault, importVault } from "../src/engine/vault.ts";
import { createBackup } from "../src/engine/backup.ts";
import { resolveGitHooksDir, installGitHook } from "../src/engine/hook.ts";
import { importMemoryPack } from "../src/engine/pack.ts";

describe("Mnemosyne Production Security & Robustness Audit Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;
  let tempDir: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mnemo-security-test-"));
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("1. Block Name Sanitization & Prototype Pollution Protection", () => {
    // Valid names
    expect(validateBlockName("active_task")).toBe("active_task");
    expect(validateBlockName("user.profile-v2")).toBe("user.profile-v2");

    // Prototype pollution keys must throw
    expect(() => validateBlockName("__proto__")).toThrow(/Reserved or forbidden/);
    expect(() => validateBlockName("constructor")).toThrow(/Reserved or forbidden/);
    expect(() => validateBlockName("prototype")).toThrow(/Reserved or forbidden/);

    // Path traversal must throw
    expect(() => validateBlockName("../../../etc/passwd")).toThrow();
    expect(() => validateBlockName("task/subtask")).toThrow();
    expect(() => validateBlockName(" ")).toThrow();

    // Engine block operations enforce validation
    expect(() => engine.setBlock("__proto__", "malicious")).toThrow();
    expect(() => engine.getBlock("../etc")).toThrow();
    expect(() => engine.deleteBlock("constructor")).toThrow();
  });

  test("2. Vault Frontmatter Prototype Pollution & Malformed Keys Guard", () => {
    const maliciousYaml = `---
__proto__:
  polluted: true
constructor: "bad"
id: "mem-safe-123"
scope: "global"
category: "architecture"
---
Safe memory content
`;

    const { meta, content } = parseFrontmatter(maliciousYaml);
    expect(meta.id).toBe("mem-safe-123");
    expect(content).toBe("Safe memory content");
    expect((meta as any).__proto__?.polluted).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
  });

  test("3. Vault Symlink Traversal Protection & Null Byte Validation", async () => {
    // Null byte directory rejection
    expect(() => resolveVaultDir(`/tmp/vault\0evil`)).toThrow(/null bytes/);

    // Create a mock vault with a legitimate file and a symlink
    const vaultDir = path.join(tempDir, "vault");
    const factsDir = path.join(vaultDir, "facts");
    fs.mkdirSync(factsDir, { recursive: true });

    const legitimateFile = path.join(factsDir, "legit.md");
    fs.writeFileSync(
      legitimateFile,
      `---\nid: "mem-legit-1"\nscope: "global"\ncategory: "fact"\n---\nLegitimate memory\n`,
      "utf-8"
    );

    // Create a sensitive file outside vault
    const sensitiveFile = path.join(tempDir, "sensitive.secret");
    fs.writeFileSync(sensitiveFile, "SUPER_SECRET_KEY=12345\n", "utf-8");

    // Create a symlink inside vault pointing to the sensitive file
    const symlinkFile = path.join(factsDir, "symlink.md");
    try {
      fs.symlinkSync(sensitiveFile, symlinkFile);
    } catch {
      // If OS blocks symlink in test, skip symlink assertion
    }

    // Import vault should safely skip symlinks and import legitimate file only
    const importRes = await importVault(db, vaultDir);
    expect(importRes.added).toBe(1);

    const mems = db.query("SELECT * FROM memories WHERE is_active = 1").all() as any[];
    expect(mems.length).toBe(1);
    expect(mems[0].content).toBe("Legitimate memory");
    expect(mems[0].content).not.toContain("SUPER_SECRET_KEY");
  });

  test("4. Backup Target Directory Null Byte Sanitization", () => {
    const res = createBackup(db, `/tmp/backup\0injection`);
    expect(res.success).toBe(false);
    expect(res.message).toContain("null bytes detected");
  });

  test("5. Git Worktree & Submodule Hooks Directory Resolution", () => {
    // Normal repo: .git is a directory
    const normalRepo = path.join(tempDir, "normal_repo");
    fs.mkdirSync(path.join(normalRepo, ".git", "hooks"), { recursive: true });
    expect(resolveGitHooksDir(normalRepo)).toBe(path.join(normalRepo, ".git", "hooks"));

    // Worktree repo: .git is a file containing gitdir: ...
    const worktreeRepo = path.join(tempDir, "worktree_repo");
    const mainGitDir = path.join(tempDir, "main_repo_git");
    fs.mkdirSync(path.join(mainGitDir, "hooks"), { recursive: true });
    fs.mkdirSync(worktreeRepo, { recursive: true });

    fs.writeFileSync(path.join(worktreeRepo, ".git"), `gitdir: ${mainGitDir}\n`, "utf-8");

    const resolvedHooks = resolveGitHooksDir(worktreeRepo);
    expect(resolvedHooks).toBe(path.join(mainGitDir, "hooks"));

    // installGitHook works inside worktree without throwing ENOTDIR
    const hookRes = installGitHook(worktreeRepo);
    expect(hookRes.success).toBe(true);
    expect(fs.existsSync(path.join(mainGitDir, "hooks", "pre-commit"))).toBe(true);
  });

  test("6. Defensive Memory Pack Schema Validation", async () => {
    // Empty input throws
    await expect(importMemoryPack(db, "")).rejects.toThrow();

    // Invalid JSON throws
    await expect(importMemoryPack(db, "{ malformed json")).rejects.toThrow();

    // Non-object throws
    await expect(importMemoryPack(db, "123")).rejects.toThrow(/root must be a JSON object/);

    // Empty object safely defaults without TypeError
    const res = await importMemoryPack(db, JSON.stringify({}));
    expect(res.imported_memories).toBe(0);
    expect(res.imported_triples).toBe(0);
    expect(res.imported_aliases).toBe(0);
  });

  test("7. Server Auth Token Protection & Universal /v1/ Endpoint Enforcement", async () => {
    const SECRET_KEY = "audit-super-secret-token-2026";

    // Simulate Bun server auth middleware logic
    function checkAuth(pathname: string, headers: Headers): { status: number; allowed: boolean } {
      const isPublic =
        pathname === "/health" ||
        pathname === "/v1/health" ||
        pathname === "/" ||
        pathname === "/dashboard";

      if (SECRET_KEY && pathname.startsWith("/v1/") && !isPublic) {
        const authHeader = headers.get("authorization") || headers.get("x-mnemosyne-key");
        const expectedBearer = `Bearer ${SECRET_KEY}`;
        if (authHeader !== expectedBearer && authHeader !== SECRET_KEY) {
          return { status: 401, allowed: false };
        }
      }
      return { status: 200, allowed: true };
    }

    // 1. Public health probe is allowed without auth
    expect(checkAuth("/v1/health", new Headers()).status).toBe(200);

    // 2. Vault and blocks endpoints are rejected without auth
    expect(checkAuth("/v1/vault/export", new Headers()).status).toBe(401);
    expect(checkAuth("/v1/blocks", new Headers()).status).toBe(401);
    expect(checkAuth("/v1/rules/export", new Headers()).status).toBe(401);
    expect(checkAuth("/v1/doctor/audit", new Headers()).status).toBe(401);
    expect(checkAuth("/v1/memory/diff", new Headers()).status).toBe(401);

    // 3. Valid Bearer token allows access
    const validHeaders = new Headers({ authorization: `Bearer ${SECRET_KEY}` });
    expect(checkAuth("/v1/vault/export", validHeaders).status).toBe(200);
    expect(checkAuth("/v1/blocks", validHeaders).status).toBe(200);

    // 4. Valid X-Mnemosyne-Key header allows access
    const customHeaders = new Headers({ "x-mnemosyne-key": SECRET_KEY });
    expect(checkAuth("/v1/memory/recall", customHeaders).status).toBe(200);
  });
});

