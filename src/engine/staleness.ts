import type { Database } from "bun:sqlite";
import type { GitAnchorRecord, StalenessReport, StalenessStatus } from "../types.ts";
import { existsSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";

function computeFileHash(filePath: string): string | undefined {
  try {
    const stats = statSync(filePath);
    if (stats.size > 5 * 1024 * 1024) return undefined; // Skip hashing files > 5MB
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return undefined;
  }
}

function getGitCommitHash(filePath: string, repoPath: string): string {
  try {
    const proc = Bun.spawnSync(["git", "log", "-n", "1", "--format=%H", "--", filePath], {
      cwd: repoPath,
      stderr: "pipe",
    });
    const hash = proc.stdout.toString().trim();
    if (hash && hash.length === 40) return hash;
  } catch {
    // Fallback if git is not available
  }
  return "uncommitted-local";
}

/**
 * Anchor a memory belief to a specific codebase file and Git state
 */
export function anchorMemory(
  db: Database,
  memoryId: string,
  filePath: string,
  repoPath: string = process.cwd()
): GitAnchorRecord {
  const absPath = resolve(repoPath, filePath);
  const relPath = relative(repoPath, absPath);
  const now = Date.now();

  const fileExists = existsSync(absPath);
  let fileMtime = 0;
  let fileHash: string | undefined = undefined;
  let commitHash = "unknown";

  if (fileExists) {
    try {
      const stats = statSync(absPath);
      fileMtime = Math.floor(stats.mtimeMs);
      fileHash = computeFileHash(absPath);
      commitHash = getGitCommitHash(relPath, repoPath);
    } catch (err: any) {
      console.warn("Could not read file stats for anchor:", err.message);
    }
  }

  const status: StalenessStatus = fileExists ? "fresh" : "unlinked";

  const record: GitAnchorRecord = {
    memory_id: memoryId,
    repo_path: repoPath,
    file_path: relPath,
    commit_hash: commitHash,
    file_mtime: fileMtime,
    file_hash: fileHash,
    status,
    last_verified_at: now,
  };

  db.query(`
    INSERT INTO memory_git_anchors (
      memory_id, repo_path, file_path, commit_hash, 
      file_mtime, file_hash, status, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      repo_path = excluded.repo_path,
      file_path = excluded.file_path,
      commit_hash = excluded.commit_hash,
      file_mtime = excluded.file_mtime,
      file_hash = excluded.file_hash,
      status = excluded.status,
      last_verified_at = excluded.last_verified_at
  `).run(
    record.memory_id,
    record.repo_path,
    record.file_path,
    record.commit_hash,
    record.file_mtime,
    record.file_hash || null,
    record.status,
    record.last_verified_at
  );

  return record;
}

/**
 * Check if an anchored memory has become stale due to code changes or file deletion
 */
export function checkMemoryStaleness(
  db: Database,
  memoryId: string
): { status: StalenessStatus; reason: string; anchor?: GitAnchorRecord } {
  const anchor = db.query(`
    SELECT * FROM memory_git_anchors WHERE memory_id = ?
  `).get(memoryId) as GitAnchorRecord | null;

  if (!anchor) {
    return { status: "fresh", reason: "Memory is not anchored to any codebase file." };
  }

  const absPath = resolve(anchor.repo_path, anchor.file_path);
  const now = Date.now();

  if (!existsSync(absPath)) {
    db.query("UPDATE memory_git_anchors SET status = 'unlinked', last_verified_at = ? WHERE memory_id = ?")
      .run(now, memoryId);
    return {
      status: "unlinked",
      reason: `Target file '${anchor.file_path}' has been deleted or moved.`,
      anchor: { ...anchor, status: "unlinked", last_verified_at: now },
    };
  }

  try {
    const stats = statSync(absPath);
    const currentMtime = Math.floor(stats.mtimeMs);
    const currentHash = computeFileHash(absPath);

    // If file hash is available and differs, it's stale
    if (anchor.file_hash && currentHash && anchor.file_hash !== currentHash) {
      db.query("UPDATE memory_git_anchors SET status = 'stale', last_verified_at = ? WHERE memory_id = ?")
        .run(now, memoryId);
      return {
        status: "stale",
        reason: `Target file '${anchor.file_path}' content has changed (SHA-256 mismatch).`,
        anchor: { ...anchor, status: "stale", last_verified_at: now },
      };
    }

    // If mtime differed significantly (> 2000ms) without hash
    if (!anchor.file_hash && Math.abs(currentMtime - anchor.file_mtime) > 2000) {
      db.query("UPDATE memory_git_anchors SET status = 'stale', last_verified_at = ? WHERE memory_id = ?")
        .run(now, memoryId);
      return {
        status: "stale",
        reason: `Target file '${anchor.file_path}' modification timestamp changed.`,
        anchor: { ...anchor, status: "stale", last_verified_at: now },
      };
    }

    db.query("UPDATE memory_git_anchors SET status = 'fresh', last_verified_at = ? WHERE memory_id = ?")
      .run(now, memoryId);
    return {
      status: "fresh",
      reason: `Code anchor matches current file state on disk.`,
      anchor: { ...anchor, status: "fresh", last_verified_at: now },
    };
  } catch (err: any) {
    return {
      status: "stale",
      reason: `Failed inspecting file: ${err.message}`,
      anchor,
    };
  }
}

/**
 * Scan all anchored memories across workspace
 */
export function scanWorkspaceStaleness(db: Database): StalenessReport {
  const anchors = db.query(`SELECT * FROM memory_git_anchors`).all() as GitAnchorRecord[];
  let freshCount = 0;
  let staleCount = 0;
  let unlinkedCount = 0;
  const staleItems: StalenessReport["stale_items"] = [];

  for (const a of anchors) {
    const res = checkMemoryStaleness(db, a.memory_id);
    if (res.status === "fresh") {
      freshCount++;
    } else if (res.status === "stale") {
      staleCount++;
      staleItems.push({
        memory_id: a.memory_id,
        file_path: a.file_path,
        status: "stale",
        reason: res.reason,
      });
    } else if (res.status === "unlinked") {
      unlinkedCount++;
      staleItems.push({
        memory_id: a.memory_id,
        file_path: a.file_path,
        status: "unlinked",
        reason: res.reason,
      });
    }
  }

  return {
    total_anchored: anchors.length,
    fresh_count: freshCount,
    stale_count: staleCount,
    unlinked_count: unlinkedCount,
    stale_items: staleItems,
  };
}
