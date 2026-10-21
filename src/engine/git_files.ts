import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

/**
 * Read-only git metadata straight from the .git files, with no git subprocess.
 * Used by the REST/MCP anchor path: a hostile repository config (core.fsmonitor,
 * core.pager, gpg.program, ...) can only bite when git is executed, so not executing
 * it removes that whole class. Handles a plain `.git` directory, a `.git` file
 * (`gitdir: <path>`, used by worktrees and submodules) with `commondir`, loose refs,
 * `packed-refs`, symbolic refs and a detached HEAD.
 */

const MAX_META_BYTES = 8 * 1024 * 1024; // packed-refs can be large; never read more than this
const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/; // sha1 or sha256 object ids

export interface GitLayout {
  /** Directory containing the repository's own HEAD (the worktree's gitdir for a worktree). */
  gitDir: string;
  /** Directory holding shared refs/ and packed-refs (== gitDir unless a worktree). */
  commonDir: string;
}

export interface GitHeadInfo {
  layout: GitLayout;
  /** Branch ref when HEAD is symbolic (e.g. refs/heads/main), null when detached. */
  ref: string | null;
  /** Commit id HEAD points at, or null for an unborn branch. */
  sha: string | null;
}

function readSmall(path: string, max = 64 * 1024): string | null {
  let fd: number | undefined;
  try {
    const st = lstatSync(path);
    if (!st.isFile()) return null; // no symlinks, fifos or devices
    fd = openSync(path, "r");
    const size = Math.min(fstatSync(fd).size, max);
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) {
      const n = readSync(fd, buf, off, size - off, off);
      if (n <= 0) break;
      off += n;
    }
    return buf.subarray(0, off).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** A ref name we are willing to turn into a path: refs/... with no traversal. */
export function isSafeRefName(ref: string): boolean {
  if (!ref.startsWith("refs/") || ref.length > 512) return false;
  if (ref.includes("..") || ref.includes("\\") || ref.includes("\0") || ref.endsWith("/") || ref.endsWith(".lock")) return false;
  return ref.split("/").every((part) => part.length > 0 && part !== "." && !part.startsWith("."));
}

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Locate the git metadata for a work tree. `allow` (realpath -> boolean) confines
 * where a `.git` file may point: a `gitdir:` line aimed at /etc or another user's
 * repo is refused instead of followed.
 */
export function findGitLayout(workTree: string, allow: (realPath: string) => boolean = () => true): GitLayout | null {
  const dotGit = join(workTree, ".git");
  let st;
  try {
    st = lstatSync(dotGit);
  } catch {
    return null;
  }
  let gitDir: string;
  if (st.isDirectory()) {
    gitDir = dotGit;
  } else if (st.isFile()) {
    const txt = readSmall(dotGit, 4096);
    const m = txt?.match(/^gitdir:\s*(.+?)\s*$/m);
    if (!m) return null;
    gitDir = isAbsolute(m[1]) ? m[1] : resolve(workTree, m[1]);
  } else {
    return null;
  }
  try {
    gitDir = realpathSync(gitDir);
  } catch {
    return null;
  }
  if (!allow(gitDir)) return null;
  let commonDir = gitDir;
  const common = readSmall(join(gitDir, "commondir"), 4096)?.trim();
  if (common) {
    try {
      commonDir = realpathSync(isAbsolute(common) ? common : resolve(gitDir, common));
    } catch {
      return null;
    }
    if (!allow(commonDir)) return null;
  }
  if (!existsSync(join(gitDir, "HEAD"))) return null;
  return { gitDir, commonDir };
}

function lookupPackedRef(commonDir: string, ref: string): string | null {
  const txt = readSmall(join(commonDir, "packed-refs"), MAX_META_BYTES);
  if (!txt) return null;
  for (const line of txt.split("\n")) {
    if (!line || line[0] === "#" || line[0] === "^") continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    if (line.slice(sp + 1).trim() === ref) {
      const sha = line.slice(0, sp).trim().toLowerCase();
      return SHA_RE.test(sha) ? sha : null;
    }
  }
  return null;
}

/** Resolve a ref (following up to 5 symbolic hops) to a commit id. */
export function resolveRef(layout: GitLayout, ref: string, depth = 0): string | null {
  if (depth > 5 || !isSafeRefName(ref)) return null;
  // Per-worktree refs (HEAD-like, refs/bisect, refs/worktree) live in gitDir; the rest in commonDir.
  for (const dir of ref.startsWith("refs/worktree/") || ref.startsWith("refs/bisect/") ? [layout.gitDir] : [layout.commonDir, layout.gitDir]) {
    const p = join(dir, ...ref.split("/"));
    if (!inside(resolve(p), dir)) return null;
    const txt = readSmall(p, 4096)?.trim();
    if (!txt) continue;
    if (txt.startsWith("ref:")) return resolveRef(layout, txt.slice(4).trim(), depth + 1);
    const sha = txt.toLowerCase();
    if (SHA_RE.test(sha)) return sha;
  }
  return lookupPackedRef(layout.commonDir, ref);
}

/** HEAD of a work tree without running git. */
export function readGitHead(workTree: string, allow?: (realPath: string) => boolean): GitHeadInfo | null {
  const layout = findGitLayout(workTree, allow);
  if (!layout) return null;
  const head = readSmall(join(layout.gitDir, "HEAD"), 4096)?.trim();
  if (!head) return null;
  if (head.startsWith("ref:")) {
    const ref = head.slice(4).trim();
    if (!isSafeRefName(ref)) return null;
    return { layout, ref, sha: resolveRef(layout, ref) };
  }
  const sha = head.toLowerCase();
  return { layout, ref: null, sha: SHA_RE.test(sha) ? sha : null };
}

/** Nearest enclosing work tree (directory containing .git) without leaving `stopAt`. */
export function findWorkTree(start: string): string | null {
  let cur = resolve(start);
  for (;;) {
    if (existsSync(join(cur, ".git"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** True when the work tree, its .git and .git/config are owned by the current uid. */
export function repoOwnedByCurrentUser(workTree: string): boolean {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (uid < 0) return false; // cannot verify (e.g. Windows): refuse
  const layout = findGitLayout(workTree);
  if (!layout) return false;
  try {
    for (const p of [workTree, layout.gitDir, layout.commonDir, join(layout.commonDir, "config")]) {
      if (!existsSync(p)) continue;
      if (statSync(p).uid !== uid) return false;
    }
    return true;
  } catch {
    return false;
  }
}
