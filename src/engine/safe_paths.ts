import { existsSync, realpathSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { CONFIG } from "../config.ts";
import { findWorkTree, repoOwnedByCurrentUser } from "./git_files.ts";
import { findGitRoot, resolveGitHooksDir } from "./hook.ts";

/** Raised when an API-supplied path falls outside the allow-listed roots (HTTP 403). */
export class PathConfinementError extends Error {
  readonly status = 403;
}

/**
 * Filesystem/process confinement for paths that arrive from a REST body or an MCP
 * tool call. The CLI is the user typing at their own shell and keeps free paths;
 * network/agent callers may only touch workspaces under an allow-listed root, or
 * the mnemo data directory (the directory holding the DB, e.g. ~/.mnemosyne).
 *
 * Roots: MNEMO_WORKSPACE_ROOTS (or the older name MNEMO_ANCHOR_ROOTS), a
 * path-delimiter-separated list (":" on POSIX). There is NO default: when unset,
 * path-taking API features are refused with 403 (except inside the data dir), so a
 * daemon started from $HOME never silently exposes every repo under it.
 * A root is rejected when it is "/", $HOME (or any ancestor of $HOME), or a system
 * directory (/etc, /usr, /var, /root, /bin, /proc, ... or anything inside the
 * strictly-system ones).
 */
const SYSTEM_EXACT = ["/var", "/opt", "/srv", "/tmp", "/home", "/Users", "/private", "/mnt", "/media", "/run", "/snap", "/Library", "/System", "/Applications", "/Volumes"];
const SYSTEM_TREE = ["/etc", "/usr", "/root", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32", "/boot", "/dev", "/proc", "/sys", "/private/etc", "/var/log", "/var/lib", "/var/run", "/var/spool", "/var/db"];

function realOrResolved(p: string): string {
  try { return realpathSync(resolve(p)); } catch { return resolve(p); }
}

/** Why a candidate root is refused, or null when it is acceptable. */
export function rootRejection(real: string): string | null {
  if (real === sep || real === dirname(real)) return "filesystem root";
  const homes = new Set<string>();
  for (const h of [homedir(), process.env.HOME]) if (h) homes.add(realOrResolved(h));
  for (const h of homes) {
    if (real === h) return "$HOME";
    if (isInside(h, real)) return "an ancestor of $HOME";
  }
  for (const d of SYSTEM_EXACT) if (real === d || real === realOrResolved(d)) return "system directory";
  for (const d of SYSTEM_TREE) {
    if (isInside(real, d)) return "system directory";
    const rd = realOrResolved(d);
    if (rd !== d && isInside(real, rd)) return "system directory";
  }
  return null;
}

/** The data dir is ours (it may live under /root or $HOME), but never "/", $HOME itself or an ancestor. */
function dataDirRejection(real: string): string | null {
  const why = rootRejection(real);
  return why === "system directory" && !SYSTEM_EXACT.includes(real) ? null : why;
}

export interface RootsReport { roots: string[]; rejected: Array<{ path: string; reason: string }>; configured: boolean }

export function workspaceRootsReport(): RootsReport {
  const raw = process.env.MNEMO_WORKSPACE_ROOTS || process.env.MNEMO_ANCHOR_ROOTS || "";
  const list = raw ? raw.split(delimiter).map((s) => s.trim()).filter(Boolean) : [];
  const out: string[] = [];
  const rejected: RootsReport["rejected"] = [];
  for (const r of list) {
    let real: string;
    try {
      real = realpathSync(resolve(r));
    } catch {
      rejected.push({ path: r, reason: "does not exist" });
      continue;
    }
    const why = rootRejection(real);
    if (why) { rejected.push({ path: r, reason: why }); continue; }
    if (!out.includes(real)) out.push(real);
  }
  return { roots: out, rejected, configured: list.length > 0 };
}

export function workspaceRoots(): string[] {
  return workspaceRootsReport().roots;
}

/** The mnemo data directory (holds the DB, backups, default vault). Always allowed. */
export function mnemoDataDir(): string {
  return realpathLoose(dirname(resolve(process.env.MNEMO_DB_PATH || CONFIG.DB_PATH)));
}

/** Every directory an API caller may touch: configured roots plus the data dir. */
export function allowedApiDirs(): string[] {
  const dirs = workspaceRoots();
  const data = mnemoDataDir();
  if (!dataDirRejection(data) && !dirs.includes(data)) dirs.push(data);
  return dirs;
}

/** True when an (already realpath'd) path is inside a root or the data dir. */
export function isAllowedApiPath(realPath: string): boolean {
  return allowedApiDirs().some((d) => isInside(realPath, d));
}

function noRootsMessage(what: string): string {
  const rep = workspaceRootsReport();
  if (!rep.configured) {
    return `${what} is disabled for API/MCP callers: MNEMO_WORKSPACE_ROOTS is not set. ` +
      `Set it to the project directories this daemon may touch (":"-separated, not $HOME or a system dir); ` +
      `only paths inside the mnemo data dir are allowed until then.`;
  }
  const rej = rep.rejected.map((r) => `${r.path} (${r.reason})`).join(", ");
  return `${what} must be inside a workspace root (MNEMO_WORKSPACE_ROOTS)` + (rej ? `; rejected roots: ${rej}` : "");
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
  if (requested === undefined || requested === null || requested === "") {
    if (roots.length === 0) throw new PathConfinementError(noRootsMessage(what));
    return roots[0];
  }
  const s = assertString(requested, what);
  if (!isAbsolute(s) && roots.length === 0) throw new PathConfinementError(noRootsMessage(what));
  const target = realpathLoose(isAbsolute(s) ? s : join(roots[0], s));
  if (isAllowedApiPath(target)) return target;
  throw new PathConfinementError(noRootsMessage(what));
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

/**
 * Gate for the one API feature that still runs git (capture/git needs the commit
 * message, which lives in a possibly packed object). REST/MCP callers get it only
 * when the operator opted in with MNEMO_ALLOW_GIT=1 AND the repository (work tree,
 * .git and its config) is owned by the uid running mnemo. safeGit's hardening still
 * applies on top. The CLI does not go through this gate.
 */
export function assertApiGitAllowed(dir: string, what = "capture/git"): string {
  if (process.env.MNEMO_ALLOW_GIT !== "1") {
    throw new PathConfinementError(`${what} runs git and is disabled for API/MCP callers; set MNEMO_ALLOW_GIT=1 to opt in (use the CLI \`mnemo capture\` otherwise)`);
  }
  const tree = findWorkTree(dir);
  if (!tree) throw new PathConfinementError(`${what}: not inside a git repository`);
  if (!isAllowedApiPath(realpathLoose(tree))) throw new PathConfinementError(noRootsMessage(`git repository for ${what}`));
  if (!repoOwnedByCurrentUser(tree)) {
    throw new PathConfinementError(`${what}: repository is not owned by the current user; refusing to run git in it`);
  }
  return tree;
}

/**
 * hooks install/uninstall write an executable into the repo's hooks dir. A `.git`
 * *file* (`gitdir: ...`) can point that dir anywhere, so the resolved hooks dir must
 * itself be inside an allowed directory.
 */
export function assertApiHooksDirAllowed(dir: string): void {
  const repo = findGitRoot(dir);
  if (!repo) return; // the engine reports "not a git repository" itself
  const hooks = realpathLoose(resolveGitHooksDir(repo));
  if (!isAllowedApiPath(hooks)) throw new PathConfinementError(noRootsMessage("git hooks directory"));
}
