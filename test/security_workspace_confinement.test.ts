/**
 * Regression tests for the anchor / git / workspace-path confinement fix:
 * REST and MCP callers could pass an arbitrary repo_path/cwd/target_dir, giving a
 * file existence+hash oracle anywhere on disk and running `git` inside an
 * attacker-chosen directory whose .git/config (core.fsmonitor, core.pager,
 * gpg.program...) executes programs.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, symlinkSync, realpathSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAnchorForApi, resolveWorkspaceDirForApi, safeGit, workspaceRoots } from "../src/engine/safe_paths.ts";

const SERVER = join(import.meta.dir, "..", "src", "server.ts");
const MCP = join(import.meta.dir, "..", "src", "mcp.ts");
const TOKEN = "conf-token-" + Math.random().toString(36).slice(2);

let base: string;
let root: string; // allow-listed workspace root
let outside: string; // sibling dir outside the root
let home: string;
let marker: string;
let proc: ReturnType<typeof Bun.spawn>;

function git(cwd: string, ...args: string[]) {
  const p = Bun.spawnSync(["git", ...args], { cwd, env: { PATH: process.env.PATH || "", HOME: home, GIT_CONFIG_NOSYSTEM: "1" } });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
}

/** A repo whose .git/config tries to run `touch <marker>` via every exec-capable key. */
function hostileRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  writeFileSync(join(dir, "a.ts"), "export function f() { return 1; }\n");
  git(dir, "add", "a.ts");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "a");
  const cmd = `touch ${marker}`;
  appendFileSync(
    join(dir, ".git", "config"),
    `[core]\n\tfsmonitor = "${cmd}; echo"\n\tpager = "${cmd}; cat"\n[log]\n\tshowSignature = true\n[gpg]\n\tprogram = "${join(dir, "evil.sh")}"\n`
  );
  writeFileSync(join(dir, "evil.sh"), `#!/bin/sh\n${cmd}\n`, { mode: 0o755 });
}

beforeAll(async () => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "mnemo-conf-")));
  root = join(home, "ws");
  outside = join(home, "outside");
  marker = join(home, "PWNED");
  mkdirSync(root);
  mkdirSync(outside);
  hostileRepo(join(root, "repo"));
  hostileRepo(join(outside, "repo"));
  writeFileSync(join(outside, "secret.txt"), "s3cret");
  symlinkSync(join(outside, "secret.txt"), join(root, "repo", "link.txt"));
  symlinkSync(outside, join(root, "escape"));

  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = s.port as number;
  s.stop(true);
  base = `http://127.0.0.1:${port}`;
  proc = Bun.spawn(["bun", "run", SERVER], {
    cwd: root, // default workspace root = daemon cwd
    env: {
      PATH: process.env.PATH || "",
      HOME: home,
      MNEMO_DB_PATH: join(home, "memory.db"),
      MNEMO_PORT: String(port),
      MNEMO_DERIVER: "off",
      MNEMO_AUTH_TOKEN: TOKEN,
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("daemon did not start");
});

afterAll(() => {
  proc?.kill();
  rmSync(home, { recursive: true, force: true });
});

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: H, body: JSON.stringify(body) });

describe("safeGit", () => {
  test("hostile repo config cannot execute programs (fsmonitor, pager, gpg.program)", () => {
    const repo = join(outside, "repo");
    for (const args of [["log", "-n", "1", "--format=%H", "--", "a.ts"], ["status", "--porcelain"], ["log", "-n", "1"]]) {
      const r = safeGit(args, repo);
      expect(r.exitCode).toBe(0);
    }
    expect(existsSync(marker)).toBe(false);
  });

  test("control: the same repo DOES execute with plain git (the test is meaningful)", () => {
    const p = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: join(outside, "repo"), env: { PATH: process.env.PATH || "", HOME: home } });
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
  });
});

describe("path confinement helpers", () => {
  test("roots never include '/' and default to cwd", () => {
    const prev = process.env.MNEMO_WORKSPACE_ROOTS;
    process.env.MNEMO_WORKSPACE_ROOTS = `/:${root}`;
    try {
      expect(workspaceRoots()).toEqual([root]);
      expect(() => resolveWorkspaceDirForApi("/etc")).toThrow(/workspace root/);
      expect(() => resolveWorkspaceDirForApi(`${root}/../outside`)).toThrow(/workspace root/);
      expect(() => resolveWorkspaceDirForApi(join(root, "escape"))).toThrow(/workspace root/); // symlink out
      expect(resolveWorkspaceDirForApi("repo")).toBe(join(root, "repo"));
    } finally {
      if (prev === undefined) delete process.env.MNEMO_WORKSPACE_ROOTS;
      else process.env.MNEMO_WORKSPACE_ROOTS = prev;
    }
  });

  test("anchor file must stay inside the repo (traversal, absolute, symlink)", () => {
    const prev = process.env.MNEMO_WORKSPACE_ROOTS;
    process.env.MNEMO_WORKSPACE_ROOTS = root;
    try {
      const repo = join(root, "repo");
      expect(resolveAnchorForApi(repo, "a.ts#f")).toEqual({ repoPath: repo, filePath: "a.ts#f" });
      expect(() => resolveAnchorForApi(repo, "../../outside/secret.txt")).toThrow(/inside repo_path/);
      expect(() => resolveAnchorForApi(repo, join(outside, "secret.txt"))).toThrow(/inside repo_path/);
      expect(() => resolveAnchorForApi(repo, "link.txt")).toThrow(/inside repo_path/);
      expect(() => resolveAnchorForApi("/etc", "passwd")).toThrow(/workspace root/);
    } finally {
      if (prev === undefined) delete process.env.MNEMO_WORKSPACE_ROOTS;
      else process.env.MNEMO_WORKSPACE_ROOTS = prev;
    }
  });
});

describe("REST boundaries", () => {
  test("anchor refuses repo_path outside the root (no hash oracle on /etc/passwd)", async () => {
    for (const body of [
      { memory_id: "m1", repo_path: "/etc", file_path: "passwd" },
      { memory_id: "m1", repo_path: join(outside, "repo"), file_path: "a.ts" },
      { memory_id: "m1", file_path: "../outside/secret.txt" },
      { memory_id: "m1", repo_path: join(root, "repo"), file_path: "link.txt" },
    ]) {
      const r = await post("/v1/memory/anchor", body);
      expect(r.status).toBe(403);
      const j = (await r.json()) as any;
      expect(j.anchor).toBeUndefined();
    }
  });

  test("anchor inside the root works and git runs hardened (hostile config inert)", async () => {
    const mem = (await (await post("/v1/memory/remember", { content: "f() returns 1 in a.ts" })).json()) as any;
    const memId = mem.id ?? mem.memory_id ?? mem.memoryId;
    expect(typeof memId).toBe("string");
    const r = await post("/v1/memory/anchor", { memory_id: memId, repo_path: join(root, "repo"), file_path: "a.ts#f" });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.anchor.status).toBe("fresh");
    expect(j.anchor.commit_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(marker)).toBe(false);
  });

  test("capture/git, hooks install/uninstall and rules sync refuse dirs outside the root", async () => {
    expect((await post("/v1/memory/capture/git", { cwd: join(outside, "repo") })).status).toBe(403);
    expect((await post("/v1/memory/capture/git", { cwd: "/" })).status).toBe(403);
    expect((await post("/v1/hooks/install", { target_dir: join(outside, "repo") })).status).toBe(403);
    expect((await post("/v1/hooks/uninstall", { target_dir: join(outside, "repo") })).status).toBe(403);
    expect(existsSync(join(outside, "repo", ".git", "hooks", "pre-commit"))).toBe(false);
    expect((await post("/v1/rules/sync", { targetPath: join(outside, "AGENTS.md") })).status).toBe(403);
    expect(existsSync(join(outside, "AGENTS.md"))).toBe(false);
    // Inside the root still works.
    const ok = await post("/v1/memory/capture/git", { cwd: join(root, "repo") });
    expect(ok.status).toBe(200);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("MCP boundaries", () => {
  test("anchor_code_memory / capture_git / create_backup refuse outside paths", async () => {
    const p = Bun.spawn(["bun", MCP], {
      cwd: root,
      env: { PATH: process.env.PATH || "", HOME: home, MNEMO_DB_PATH: join(home, "mcp.db"), MNEMO_DERIVER: "off" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const calls: [number, string, Record<string, unknown>][] = [
      [1, "anchor_code_memory", { memory_id: "x", repo_path: "/etc", file_path: "passwd" }],
      [2, "anchor_code_memory", { memory_id: "x", repo_path: join(root, "repo"), file_path: "a.ts" }],
      [3, "create_backup", { target_dir: join(outside, "bk") }],
      [4, "install_git_hook", { target_dir: join(outside, "repo") }],
    ];
    for (const [id, name, args] of calls) {
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
    }
    await p.stdin.end();
    const out = await new Response(p.stdout).text();
    p.kill();
    const byId = new Map<number, any>();
    for (const line of out.split("\n")) {
      try {
        const j = JSON.parse(line);
        if (typeof j.id === "number") byId.set(j.id, j);
      } catch {}
    }
    expect(byId.get(1)?.error?.message).toMatch(/workspace root/);
    // Inside the root passes confinement (it may still fail on the unknown memory id).
    expect(byId.get(2)).toBeDefined();
    expect(String(byId.get(2)?.error?.message ?? "")).not.toMatch(/workspace root|inside repo_path/);
    expect(byId.get(3)?.error?.message).toMatch(/workspace root/);
    expect(byId.get(4)?.error?.message).toMatch(/workspace root/);
    expect(existsSync(join(outside, "bk"))).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });
});
