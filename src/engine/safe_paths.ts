import { existsSync, realpathSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";

/** Raised when an API-supplied path falls outside the allow-listed roots (HTTP 403). */
export class PathConfinementError extends Error {
  readonly status = 403;
}

/**
 * Filesystem/process confinement for paths that arrive from a REST body or an MCP
 * tool call. The CLI is the user typing at their own shell and keeps free paths;
 * network/agent callers may only touch workspaces under an allow-listed root.
 *
 * Roots: MNEMO_WORKSPACE_ROOTS (or the older name MNEMO_ANCHOR_ROOTS), a
 * path-delimiter-separated list (":" on POSIX). Default: the daemon's own working
 * directory. The filesystem root "/" is never accepted as a root, so a daemon
 * started from "/" confines API callers to nothing until roots are configured.
 */
export function workspaceRoots(): string[] {
  const raw = process.env.MNEMO_WORKSPACE_ROOTS || process.env.MNEMO_ANCHOR_ROOTS || "";
  const list = raw ? raw.split(delimiter).map((s) => s.trim()).filter(Boolean) : [process.cwd()];
  const out: string[] = [];
  for (const r of list) {
    try {
      const real = realpathSync(resolve(r));
      if (real === sep || real === dirname(real)) continue; // never "/"
      if (!out.includes(real)) out.push(real);
    } catch {
      // nonexistent root: skip
    }
  }
  return out;
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** realpath of the longest existing prefix, with the non-existent tail re-appended. */
export function realpathLoose(p: string): string {
  let cur = resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur)) {
    rest.unshift(basename(cur));
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return join(realpathSync(cur), ...rest);
}

function assertString(v: unknown, what: string): string {
  if (typeof v !== "string" || !v.trim() || v.includes("\0")) throw new PathConfinementError(`Invalid ${what}`);
  return v;
}

/**
 * Resolve a directory supplied by an API caller to its realpath and require it to be
 * inside a workspace root. Undefined/empty means the first root.
 */
export function resolveWorkspaceDirForApi(requested: unknown, what = "directory"): string {
  const roots = workspaceRoots();
  if (roots.length === 0) {
    throw new PathConfinementError(`No workspace root configured (set MNEMO_WORKSPACE_ROOTS); refusing ${what}`);
  }
  if (requested === undefined || requested === null || requested === "") return roots[0];
  const s = assertString(requested, what);
  const target = realpathLoose(isAbsolute(s) ? s : join(roots[0], s));
  for (const r of roots) if (isInside(target, r)) return target;
  throw new PathConfinementError(`${what} must be inside a workspace root (MNEMO_WORKSPACE_ROOTS)`);
}

/**
 * Anchor target for an API caller: repo inside a root (realpath), file inside the repo
 * (realpath when it exists, so a symlink cannot point outside). Returns the paths the
 * engine should use.
 */
export function resolveAnchorForApi(repoPath: unknown, filePath: unknown): { repoPath: string; filePath: string } {
  const repo = resolveWorkspaceDirForApi(repoPath, "repo_path");
  if (!existsSync(repo)) throw new PathConfinementError("repo_path does not exist");
  const raw = assertString(filePath, "file_path");
  const hash = raw.indexOf("#");
  const fileOnly = hash >= 0 ? raw.slice(0, hash) : raw;
  const symbol = hash >= 0 ? raw.slice(hash) : "";
  if (!fileOnly.trim()) throw new PathConfinementError("Invalid file_path");
  const abs = realpathLoose(isAbsolute(fileOnly) ? fileOnly : join(repo, fileOnly));
  if (!isInside(abs, repo) || abs === repo) throw new PathConfinementError("file_path must be inside repo_path");
  return { repoPath: repo, filePath: abs.slice(repo.length + 1) + symbol };
}

/** Repo-controlled config keys that can make git execute programs; all neutralised. */
const SAFE_GIT_CONFIG = [
  "core.fsmonitor=",
  "core.pager=cat",
  "core.hooksPath=/dev/null",
  "core.sshCommand=false",
  "core.askPass=",
  "credential.helper=",
  "diff.external=",
  "log.showSignature=false",
  "gpg.program=false",
  "protocol.ext.allow=never",
];

export interface SafeGitResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }

/**
 * Run git with no shell, a minimal environment, hostile-config keys overridden on the
 * command line (command-line config beats repo config), no system config, no prompts
 * and a hard timeout. Note: safe.directory is deliberately NOT overridden, so git's
 * own ownership check (CVE-2022-24765) still refuses repos owned by another user.
 */
export function safeGit(args: string[], cwd: string, timeoutMs = 5000): SafeGitResult {
  const argv = ["git", "--no-pager"];
  for (const kv of SAFE_GIT_CONFIG) argv.push("-c", kv);
  argv.push(...args);
  const env: Record<string, string> = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: process.env.HOME || "/nonexistent",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  };
  try {
    const proc = Bun.spawnSync(argv, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout?.toString() ?? "",
      stderr: proc.stderr?.toString() ?? "",
      timedOut: (proc as any).signalCode === "SIGTERM" || (proc as any).exitedDueToTimeout === true,
    };
  } catch (err: any) {
    return { exitCode: null, stdout: "", stderr: String(err?.message || err), timedOut: false };
  }
}

/**
 * Directory for a git-touching API call (capture/hooks). Both the requested directory
 * and the repository root git would actually run in (found by walking up) must be
 * inside a workspace root — otherwise a cwd inside a root could still run git with
 * the config of a hostile parent repository.
 */
export function resolveGitDirForApi(requested: unknown, findRoot: (dir: string) => string | null, what = "cwd"): string {
  const dir = resolveWorkspaceDirForApi(requested, what);
  const root = findRoot(dir);
  if (root) resolveWorkspaceDirForApi(root, `git repository for ${what}`);
  return dir;
}
