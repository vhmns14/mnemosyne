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
 * Fast Regex-based symbol boundary extractor:
 * Supports TypeScript, JavaScript, Python, Go, Rust.
 * Extracts function, method, class, interface, or struct body.
 */
export function extractSymbolContent(fileContent: string, symbolName: string): string | null {
  if (!fileContent || !symbolName) return null;
  const lines = fileContent.split("\n");
  const escapedName = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Patterns for symbol declaration
  const patterns = [
    // TS/JS: (export )?(async )?function <name> | (export )?(const|let|var) <name> =
    new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${escapedName}\\b`),
    new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+${escapedName}\\s*=\\s*`),
    // TS/JS/Python/Rust: class <name> | interface <name> | type <name> | struct <name> | enum <name>
    new RegExp(`^(?:export\\s+)?(?:class|interface|type|enum)\\s+${escapedName}\\b`),
    // Python: def <name>( | class <name>(
    new RegExp(`^(?:\\s*)def\\s+${escapedName}\\s*\\(`),
    new RegExp(`^(?:\\s*)class\\s+${escapedName}\\s*[:\\(]`),
    // Go: func (<receiver>)? <name>( | type <name> struct|interface
    new RegExp(`^func\\s+(?:\\([^)]+\\)\\s+)?${escapedName}\\s*\\(`),
    new RegExp(`^type\\s+${escapedName}\\s+(?:struct|interface)`),
    // Rust: (pub )?(fn|struct|enum|trait|impl) <name>
    new RegExp(`^(?:pub\\s+)?(?:fn|struct|enum|trait|type)\\s+${escapedName}\\b`),
    // Object/class method: <name>(...) {
    new RegExp(`^\\s*(?:async\\s+)?${escapedName}\\s*\\([^)]*\\)\\s*(?::\\s*[^\\{]+)?\\{`),
  ];

  let startLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of patterns) {
      if (pat.test(line)) {
        startLineIdx = i;
        break;
      }
    }
    if (startLineIdx !== -1) break;
  }

  if (startLineIdx === -1) return null;

  const firstLine = lines[startLineIdx];
  const isPython = firstLine.trim().startsWith("def ") || firstLine.trim().startsWith("class ");

  if (isPython) {
    const initialIndent = firstLine.match(/^\s*/)?.[0].length || 0;
    const extracted: string[] = [firstLine];
    for (let i = startLineIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) {
        extracted.push(line);
        continue;
      }
      const lineIndent = line.match(/^\s*/)?.[0].length || 0;
      if (lineIndent <= initialIndent && !line.trim().startsWith("#")) {
        break;
      }
      extracted.push(line);
    }
    return extracted.join("\n").trim();
  }

  let braceCount = 0;
  let hasOpened = false;
  const extracted: string[] = [];

  for (let i = startLineIdx; i < lines.length; i++) {
    const line = lines[i];
    extracted.push(line);

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === "{") {
        braceCount++;
        hasOpened = true;
      } else if (ch === "}") {
        braceCount--;
      }
    }

    if (hasOpened && braceCount <= 0) {
      break;
    }
    if (!hasOpened && line.includes(";")) {
      break;
    }
  }

  return extracted.join("\n").trim();
}

/**
 * Anchor a memory belief to a specific codebase file and optional symbol (function/class)
 */
export function anchorMemory(
  db: Database,
  memoryId: string,
  filePath: string,
  repoPath: string = process.cwd(),
  symbolName?: string
): GitAnchorRecord {
  let targetFile = filePath;
  let targetSymbol = symbolName;

  // Support file.ts#symbolName syntax
  if (filePath.includes("#")) {
    const parts = filePath.split("#");
    targetFile = parts[0];
    targetSymbol = targetSymbol || parts[1];
  }

  const absPath = resolve(repoPath, targetFile);
  const relPath = relative(repoPath, absPath);
  const now = Date.now();

  const fileExists = existsSync(absPath);
  let fileMtime = 0;
  let fileHash: string | undefined = undefined;
  let symbolHash: string | undefined = undefined;
  let commitHash = "unknown";

  if (fileExists) {
    try {
      const stats = statSync(absPath);
      fileMtime = Math.floor(stats.mtimeMs);
      fileHash = computeFileHash(absPath);
      commitHash = getGitCommitHash(relPath, repoPath);

      if (targetSymbol) {
        const content = readFileSync(absPath, "utf-8");
        const extracted = extractSymbolContent(content, targetSymbol);
        if (extracted) {
          symbolHash = createHash("sha256").update(extracted).digest("hex");
        }
      }
    } catch (err: any) {
      console.warn("Could not read file stats for anchor:", err.message);
    }
  }

  const status: StalenessStatus = fileExists ? "fresh" : "unlinked";

  const record: GitAnchorRecord = {
    memory_id: memoryId,
    repo_path: repoPath,
    file_path: relPath,
    symbol_name: targetSymbol || undefined,
    symbol_hash: symbolHash || undefined,
    commit_hash: commitHash,
    file_mtime: fileMtime,
    file_hash: fileHash,
    status,
    last_verified_at: now,
  };

  db.query(`
    INSERT INTO memory_git_anchors (
      memory_id, repo_path, file_path, symbol_name, symbol_hash,
      commit_hash, file_mtime, file_hash, status, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      repo_path = excluded.repo_path,
      file_path = excluded.file_path,
      symbol_name = excluded.symbol_name,
      symbol_hash = excluded.symbol_hash,
      commit_hash = excluded.commit_hash,
      file_mtime = excluded.file_mtime,
      file_hash = excluded.file_hash,
      status = excluded.status,
      last_verified_at = excluded.last_verified_at
  `).run(
    record.memory_id,
    record.repo_path,
    record.file_path,
    record.symbol_name || null,
    record.symbol_hash || null,
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

  // Symbol-level check: If memory is anchored to a specific symbol
  if (anchor.symbol_name) {
    try {
      const content = readFileSync(absPath, "utf-8");
      const currentSymbolContent = extractSymbolContent(content, anchor.symbol_name);

      if (!currentSymbolContent) {
        db.query("UPDATE memory_git_anchors SET status = 'stale', last_verified_at = ? WHERE memory_id = ?")
          .run(now, memoryId);
        return {
          status: "stale",
          reason: `Anchored symbol '${anchor.symbol_name}' was removed or renamed in '${anchor.file_path}'.`,
          anchor: { ...anchor, status: "stale", last_verified_at: now },
        };
      }

      const currentSymbolHash = createHash("sha256").update(currentSymbolContent).digest("hex");
      if (anchor.symbol_hash && currentSymbolHash !== anchor.symbol_hash) {
        db.query("UPDATE memory_git_anchors SET status = 'stale', last_verified_at = ? WHERE memory_id = ?")
          .run(now, memoryId);
        return {
          status: "stale",
          reason: `Anchored symbol '${anchor.symbol_name}' in '${anchor.file_path}' content has changed (SHA-256 mismatch).`,
          anchor: { ...anchor, status: "stale", last_verified_at: now },
        };
      }

      // Symbol is completely intact! Anchor remains fresh even if other parts of the file were edited!
      db.query("UPDATE memory_git_anchors SET status = 'fresh', last_verified_at = ? WHERE memory_id = ?")
        .run(now, memoryId);
      return {
        status: "fresh",
        reason: `Anchored symbol '${anchor.symbol_name}' in '${anchor.file_path}' matches anchor state.`,
        anchor: { ...anchor, status: "fresh", last_verified_at: now },
      };
    } catch (err: any) {
      return {
        status: "stale",
        reason: `Failed inspecting symbol: ${err.message}`,
        anchor,
      };
    }
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
