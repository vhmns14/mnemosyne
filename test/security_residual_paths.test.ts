/**
 * Residual-risk fixes for the path/git family:
 *  1. No implicit default root: with MNEMO_WORKSPACE_ROOTS unset, path-taking API/MCP
 *     features are refused (403) except inside the mnemo data dir; roots equal to "/",
 *     $HOME (or an ancestor) or a system dir are rejected. A `.git` file cannot steer
 *     hooks install outside the roots.
 *  2. The REST/MCP anchor path runs no git process: HEAD is read from .git files
 *     (detached HEAD, packed-refs, worktree gitdir/commondir). capture/git needs
 *     MNEMO_ALLOW_GIT=1 plus a repo owned by the current uid.
 *  3. Stored anchors are re-validated on every read; out-of-root ones are reported as
 *     "untrusted" and never opened or hashed.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, realpathSync, chownSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveWorkspaceDirForApi, workspaceRoots, workspaceRootsReport, assertApiGitAllowed } from "../src/engine/safe_paths.ts";
import { readGitHead, findGitLayout, repoOwnedByCurrentUser } from "../src/engine/git_files.ts";
import { initSchema } from "../src/db/schema.ts";
import { checkMemoryStaleness, scanWorkspaceStaleness } from "../src/engine/staleness.ts";

const SERVER = join(import.meta.dir, "..", "src", "server.ts");
const MCP = join(import.meta.dir, "..", "src", "mcp.ts");
const TOKEN = "res-token-" + Math.random().toString(36).slice(2);

let home: string; // fake $HOME
let marker: string;
let fakeBin: string;

const gitEnv = () => ({ PATH: process.env.PATH || "", HOME: home, GIT_CONFIG_NOSYSTEM: "1" });
function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, env: gitEnv() });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}
function repo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.ts"), "export function f() { return 1; }\n");
  git(dir, "add", "a.ts");
  git(dir, "commit", "-q", "-m", "feat: add f");
  return dir;
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

async function startDaemon(env: Record<string, string>, cwd: string) {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = s.port as number;
  s.stop(true);
  const base = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn(["bun", "run", SERVER], {
    cwd,
    env: {
      PATH: process.env.PATH || "",
      HOME: home,
      MNEMO_PORT: String(port),
      MNEMO_DERIVER: "off",
      MNEMO_AUTH_TOKEN: TOKEN,
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    await Bun.sleep(100);
  }
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = (path: string) => fetch(base + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return { proc, post, get };
}

async function mcpCalls(env: Record<string, string>, cwd: string, calls: [number, string, Record<string, unknown>][]) {
  const p = Bun.spawn(["bun", MCP], { cwd, env: { PATH: process.env.PATH || "", HOME: home, MNEMO_DERIVER: "off", ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  for (const [id, name, args] of calls) p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
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
  return byId;
}

beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "mnemo-res-")));
  marker = join(home, "GIT_WAS_EXECUTED");
  fakeBin = join(home, "fakebin");
  mkdirSync(fakeBin);
  // Any `git` invocation through PATH leaves a marker: proves the anchor path spawns none.
  writeFileSync(join(fakeBin, "git"), `#!/bin/sh\ntouch ${marker}\nexit 1\n`, { mode: 0o755 });
  repo(join(home, "proj"));
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("1. no implicit default root", () => {
  test("unset MNEMO_WORKSPACE_ROOTS refuses API paths except the data dir", () => {
    const data = join(home, ".mnemosyne");
    mkdirSync(data, { recursive: true });
    withEnv({ MNEMO_WORKSPACE_ROOTS: undefined, MNEMO_ANCHOR_ROOTS: undefined, MNEMO_DB_PATH: join(data, "memory.db"), HOME: home }, () => {
      expect(workspaceRoots()).toEqual([]);
      expect(() => resolveWorkspaceDirForApi(join(home, "proj"), "repo_path")).toThrow(/MNEMO_WORKSPACE_ROOTS is not set/);
      expect(() => resolveWorkspaceDirForApi(undefined, "cwd")).toThrow(/disabled for API\/MCP callers/);
      expect(() => resolveWorkspaceDirForApi("proj", "cwd")).toThrow(/not set/);
      expect(resolveWorkspaceDirForApi(join(data, "backups"), "target_dir")).toBe(join(data, "backups"));
    });
  });

  test("roots equal to /, $HOME, an ancestor of $HOME or a system dir are rejected", () => {
    const proj = join(home, "proj");
    withEnv({ HOME: home, MNEMO_WORKSPACE_ROOTS: [home, dirname(home), "/", "/etc", "/usr/lib", "/var", "/root", proj].join(":") }, () => {
      const rep = workspaceRootsReport();
      expect(rep.roots).toEqual([proj]);
      const reasons = Object.fromEntries(rep.rejected.map((r) => [r.path, r.reason]));
      expect(reasons[home]).toBe("$HOME");
      expect(reasons[dirname(home)]).toBe("an ancestor of $HOME");
      expect(reasons["/"]).toBeTruthy();
      expect(reasons["/etc"]).toBe("system directory");
      expect(reasons["/usr/lib"]).toBe("system directory");
      expect(reasons["/var"]).toBe("system directory");
      expect(reasons["/root"]).toBeTruthy();
    });
    withEnv({ HOME: home, MNEMO_WORKSPACE_ROOTS: home }, () => {
      expect(() => resolveWorkspaceDirForApi(join(home, "proj"))).toThrow(/rejected roots: .*\$HOME/);
    });
  });

  test("daemon started from $HOME with no roots: every path feature 403s; data dir still works", async () => {
    const data = join(home, ".mnemosyne");
    const { proc, post } = await startDaemon({ MNEMO_DB_PATH: join(data, "d1.db") }, home);
    try {
      const mem = (await (await post("/v1/memory/remember", { content: "f returns 1" })).json()) as any;
      const id = mem.id ?? mem.memory_id;
      for (const [path, body] of [
        ["/v1/memory/anchor", { memory_id: id, repo_path: join(home, "proj"), file_path: "a.ts" }],
        ["/v1/memory/anchor", { memory_id: id, file_path: "proj/a.ts" }],
        ["/v1/memory/capture/git", { cwd: join(home, "proj") }],
        ["/v1/memory/capture/git", {}],
        ["/v1/hooks/install", { target_dir: join(home, "proj") }],
        ["/v1/hooks/uninstall", { target_dir: join(home, "proj") }],
        ["/v1/rules/sync", { targetPath: join(home, "proj", "AGENTS.md") }],
      ] as const) {
        const r = await post(path, body);
        expect(r.status).toBe(403);
        expect(((await r.json()) as any).error).toMatch(/MNEMO_WORKSPACE_ROOTS is not set/);
      }
      expect(existsSync(join(home, "proj", ".git", "hooks", "pre-commit"))).toBe(false);
      expect(existsSync(join(home, "proj", "AGENTS.md"))).toBe(false);
      const ok = await post("/v1/rules/sync", { targetPath: join(data, "AGENTS.md") });
      expect(ok.status).toBe(200);
      expect(existsSync(join(data, "AGENTS.md"))).toBe(true);
    } finally {
      proc.kill();
    }
  });

  test("MCP with no roots: backup into the data dir works, anywhere else is refused", async () => {
    const data = join(home, ".mnemosyne");
    const byId = await mcpCalls({ MNEMO_DB_PATH: join(data, "m1.db") }, home, [
      [1, "create_backup", { target_dir: join(data, "bk") }],
      [2, "create_backup", { target_dir: join(home, "proj", "bk") }],
      [3, "anchor_code_memory", { memory_id: "x", repo_path: join(home, "proj"), file_path: "a.ts" }],
    ]);
    expect(byId.get(1)?.error).toBeUndefined();
    expect(existsSync(join(data, "bk"))).toBe(true);
    expect(byId.get(2)?.error?.message).toMatch(/not set/);
    expect(existsSync(join(home, "proj", "bk"))).toBe(false);
    expect(byId.get(3)?.error?.message).toMatch(/not set/);
  });

  test("a .git file cannot redirect hooks install outside the roots", async () => {
    const ws = join(home, "ws1");
    const victim = repo(join(home, "victim"));
    mkdirSync(join(ws, "sub"), { recursive: true });
    writeFileSync(join(ws, "sub", ".git"), `gitdir: ${join(victim, ".git")}\n`);
    const { proc, post } = await startDaemon({ MNEMO_DB_PATH: join(home, ".mnemosyne", "d2.db"), MNEMO_WORKSPACE_ROOTS: ws }, ws);
    try {
      const r = await post("/v1/hooks/install", { target_dir: join(ws, "sub") });
      expect(r.status).toBe(403);
      expect(((await r.json()) as any).error).toMatch(/hooks directory/);
      expect(existsSync(join(victim, ".git", "hooks", "pre-commit"))).toBe(false);
    } finally {
      proc.kill();
    }
  });
});

describe("2. anchor path reads .git files, never runs git", () => {
  test("HEAD: branch, packed-refs, detached, worktree, traversal and confinement", () => {
    const r = repo(join(home, "g1"));
    const head = git(r, "rev-parse", "HEAD");
    expect(readGitHead(r)).toMatchObject({ ref: "refs/heads/main", sha: head });
    git(r, "pack-refs", "--all", "--prune");
    expect(existsSync(join(r, ".git", "refs", "heads", "main"))).toBe(false);
    expect(readGitHead(r)?.sha).toBe(head);
    // second commit, then detach on the first
    writeFileSync(join(r, "b.ts"), "x\n");
    git(r, "add", "b.ts");
    git(r, "commit", "-q", "-m", "b");
    const head2 = git(r, "rev-parse", "HEAD");
    expect(readGitHead(r)?.sha).toBe(head2);
    git(r, "checkout", "-q", "--detach", head);
    expect(readGitHead(r)).toMatchObject({ ref: null, sha: head });
    git(r, "checkout", "-q", "main");
    // worktree: .git is a file -> gitdir with commondir; branch ref lives in the main repo
    const wt = join(home, "g1-wt");
    git(r, "worktree", "add", "-q", "-b", "side", wt);
    expect(readFileSync(join(wt, ".git"), "utf8")).toMatch(/^gitdir:/);
    expect(readGitHead(wt)).toMatchObject({ ref: "refs/heads/side", sha: git(wt, "rev-parse", "HEAD") });
    // confinement: a gitdir outside the allowed set is not followed
    expect(findGitLayout(wt, (p) => p.startsWith(wt))).toBeNull();
    // unborn branch
    const u = join(home, "g-unborn");
    mkdirSync(u);
    git(u, "init", "-q");
    expect(readGitHead(u)?.sha).toBeNull();
    // ref traversal is refused
    const t = repo(join(home, "g-trav"));
    writeFileSync(join(t, ".git", "HEAD"), "ref: refs/../../../../etc/passwd\n");
    expect(readGitHead(t)).toBeNull();
  });

  test("REST anchor with a hostile repo and a booby-trapped `git` on PATH: nothing executes", async () => {
    const ws = join(home, "ws2");
    const r = repo(join(ws, "repo"));
    const head = git(r, "rev-parse", "HEAD");
    const { proc, post } = await startDaemon(
      { MNEMO_DB_PATH: join(home, ".mnemosyne", "d3.db"), MNEMO_WORKSPACE_ROOTS: ws, PATH: `${fakeBin}:${process.env.PATH}` },
      ws
    );
    try {
      const mem = (await (await post("/v1/memory/remember", { content: "f returns one" })).json()) as any;
      const res = await post("/v1/memory/anchor", { memory_id: mem.id ?? mem.memory_id, repo_path: r, file_path: "a.ts#f" });
      expect(res.status).toBe(200);
      const j = (await res.json()) as any;
      expect(j.anchor.commit_hash).toBe(head);
      expect(j.anchor.status).toBe("fresh");
      expect(existsSync(marker)).toBe(false);
      // capture/git is the one git user: off by default even inside the root
      const cap = await post("/v1/memory/capture/git", { cwd: r });
      expect(cap.status).toBe(403);
      expect(((await cap.json()) as any).error).toMatch(/MNEMO_ALLOW_GIT=1/);
      expect(existsSync(marker)).toBe(false);
    } finally {
      proc.kill();
    }
  });

  test("capture/git with MNEMO_ALLOW_GIT=1 works on an owned repo", async () => {
    const ws = join(home, "ws3");
    const r = repo(join(ws, "repo"));
    const { proc, post } = await startDaemon({ MNEMO_DB_PATH: join(home, ".mnemosyne", "d4.db"), MNEMO_WORKSPACE_ROOTS: ws, MNEMO_ALLOW_GIT: "1" }, ws);
    try {
      const cap = await post("/v1/memory/capture/git", { cwd: r });
      expect(cap.status).toBe(200);
      expect(((await cap.json()) as any).result.subject).toBe("feat: add f");
    } finally {
      proc.kill();
    }
  });

  test("ownership check refuses a repo whose config belongs to another uid", () => {
    const ws = join(home, "ws4");
    const r = repo(join(ws, "repo"));
    expect(repoOwnedByCurrentUser(r)).toBe(true);
    withEnv({ MNEMO_WORKSPACE_ROOTS: ws, MNEMO_ALLOW_GIT: "1" }, () => {
      expect(assertApiGitAllowed(r)).toBe(r);
      if (process.getuid?.() === 0) {
        chownSync(join(r, ".git", "config"), 65534, 65534);
        expect(repoOwnedByCurrentUser(r)).toBe(false);
        expect(() => assertApiGitAllowed(r)).toThrow(/not owned by the current user/);
      }
    });
    withEnv({ MNEMO_WORKSPACE_ROOTS: ws, MNEMO_ALLOW_GIT: undefined }, () => {
      expect(() => assertApiGitAllowed(r)).toThrow(/MNEMO_ALLOW_GIT=1/);
    });
  });
});

describe("3. stored anchors are re-validated on read", () => {
  test("out-of-root anchors are untrusted and never opened (FIFO would block if read)", () => {
    const ws = join(home, "ws5");
    const r = repo(join(ws, "repo"));
    const outside = join(home, "outside5");
    mkdirSync(outside);
    const fifo = join(outside, "trap");
    expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
    const db = new Database(":memory:");
    initSchema(db);
    const ins = (id: string, repoPath: string, file: string, sym: string | null = null) => {
      db.query("INSERT INTO memories (id, content, scope, category, importance, created_at, updated_at, last_accessed_at) VALUES (?, ?, 'global', 'fact', 'normal', 0, 0, 0)").run(id, id);
      db.query("INSERT INTO memory_git_anchors (memory_id, repo_path, file_path, symbol_name, commit_hash, file_mtime, file_hash, status, last_verified_at) VALUES (?, ?, ?, ?, 'x', 0, 'h', 'fresh', 1)").run(id, repoPath, file, sym);
    };
    ins("m-out", outside, "trap");
    ins("m-sym", outside, "trap", "f");
    ins("m-etc", "/etc", "passwd");
    ins("m-esc", r, "../../outside5/trap");
    ins("m-in", r, "a.ts");
    withEnv({ MNEMO_WORKSPACE_ROOTS: ws, MNEMO_DB_PATH: join(home, ".mnemosyne", "x.db") }, () => {
      for (const id of ["m-out", "m-sym", "m-etc", "m-esc"]) {
        const res = checkMemoryStaleness(db, id);
        expect(res.status).toBe("untrusted");
        expect(res.reason).toMatch(/outside the configured workspace roots|escapes its repo/);
      }
      const rep = scanWorkspaceStaleness(db);
      expect(rep.untrusted_count).toBe(4);
      expect(rep.stale_items.filter((i) => i.status === "untrusted").length).toBe(4);
      // stored rows are untouched (no hash, no status rewrite)
      const row = db.query("SELECT file_hash, status, last_verified_at FROM memory_git_anchors WHERE memory_id = 'm-etc'").get() as any;
      expect(row).toEqual({ file_hash: "h", status: "fresh", last_verified_at: 1 });
      // in-root anchor is still checked normally (hash 'h' != real -> stale)
      expect(checkMemoryStaleness(db, "m-in").status).toBe("stale");
    });
    // roots removed later: the formerly-good anchor becomes untrusted too
    withEnv({ MNEMO_WORKSPACE_ROOTS: undefined, MNEMO_DB_PATH: join(home, ".mnemosyne", "x.db") }, () => {
      expect(checkMemoryStaleness(db, "m-in").status).toBe("untrusted");
      // a CLI-style caller may vouch for its own dir
      expect(checkMemoryStaleness(db, "m-in", { extraRoots: [ws] }).status).toBe("stale");
    });
  });
});
