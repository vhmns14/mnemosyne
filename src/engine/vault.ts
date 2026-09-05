import type { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getEmbedding } from "./embedder.ts";
import { detectWorkspace } from "./workspace.ts";
import { recordMemoryEvent } from "./doctor.ts";
import type { 
  MemoryRecord, MemoryCategory, MemoryScope, MemoryImportance, 
  MemoryStructureType, MemoryOutcome, VaultFileFrontmatter,
  VaultExportResult, VaultImportResult, VaultSyncResult
} from "../types.ts";

/**
 * Resolves the default vault directory.
 * Prefers <workspace_root>/.mnemo/vault if in a git repo/project,
 * otherwise falls back to ~/.mnemosyne/vault.
 */
export function resolveVaultDir(customDir?: string): string {
  if (customDir) {
    if (customDir.includes("\0")) throw new Error("Invalid vault directory: null bytes detected");
    return path.resolve(customDir);
  }

  const ws = detectWorkspace();
  if (ws && ws.root_path) {
    return path.join(ws.root_path, ".mnemo", "vault");
  }

  return path.join(os.homedir(), ".mnemosyne", "vault");
}

/**
 * Creates a clean slug for a filename from memory content.
 */
export function slugify(text: string, maxLen: number = 32): string {
  const clean = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return clean.slice(0, maxLen).replace(/-+$/, "") || "memory";
}

/**
 * Serializes frontmatter metadata into clean YAML.
 */
export function serializeFrontmatter(meta: VaultFileFrontmatter, content: string): string {
  const lines: string[] = ["---"];
  lines.push(`id: "${meta.id}"`);
  lines.push(`scope: "${meta.scope}"`);
  lines.push(`category: "${meta.category}"`);
  lines.push(`importance: "${meta.importance || "normal"}"`);
  if (meta.structure_type) lines.push(`structure_type: "${meta.structure_type}"`);
  lines.push(`is_negative_constraint: ${Boolean(meta.is_negative_constraint)}`);
  lines.push(`outcome: "${meta.outcome || "neutral"}"`);

  if (meta.valid_from) {
    const vf = typeof meta.valid_from === "number" ? new Date(meta.valid_from).toISOString() : meta.valid_from;
    lines.push(`valid_from: "${vf}"`);
  }
  if (meta.valid_until) {
    const vu = typeof meta.valid_until === "number" ? new Date(meta.valid_until).toISOString() : meta.valid_until;
    lines.push(`valid_until: "${vu}"`);
  } else {
    lines.push(`valid_until: null`);
  }

  if (meta.created_at) {
    const ca = typeof meta.created_at === "number" ? new Date(meta.created_at).toISOString() : meta.created_at;
    lines.push(`created_at: "${ca}"`);
  }
  if (meta.updated_at) {
    const ua = typeof meta.updated_at === "number" ? new Date(meta.updated_at).toISOString() : meta.updated_at;
    lines.push(`updated_at: "${ua}"`);
  }

  const tags = meta.tags || [];
  if (tags.length === 0) {
    lines.push(`tags: []`);
  } else {
    lines.push(`tags:`);
    for (const t of tags) {
      lines.push(`  - "${t.replace(/"/g, '\\"')}"`);
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(content.trim());
  lines.push("");

  return lines.join("\n");
}

/**
 * Parses frontmatter metadata and body content from a Markdown file.
 */
export function parseFrontmatter(rawText: string): { meta: VaultFileFrontmatter; content: string } {
  const normalized = rawText.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) {
    return {
      meta: {
        id: "",
        scope: "global",
        category: "fact",
        tags: [],
      },
      content: normalized.trim(),
    };
  }

  const endIdx = normalized.indexOf("\n---", 3);
  if (endIdx === -1) {
    return {
      meta: {
        id: "",
        scope: "global",
        category: "fact",
        tags: [],
      },
      content: normalized.trim(),
    };
  }

  const frontmatterStr = normalized.substring(3, endIdx);
  const content = normalized.substring(endIdx + 4).trim();

  const lines = frontmatterStr.split("\n");
  const meta: any = { tags: [] };
  let inTags = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (inTags) {
      if (trimmed.startsWith("-")) {
        const val = trimmed.replace(/^-\s*/, "").replace(/^["']|["']$/g, "");
        meta.tags.push(val);
        continue;
      } else {
        inTags = false;
      }
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    let val = trimmed.substring(colonIdx + 1).trim();

    if (key === "tags") {
      if (val === "[]") {
        meta.tags = [];
      } else {
        inTags = true;
      }
      continue;
    }

    // Strip quotes
    val = val.replace(/^["']|["']$/g, "");
    if (val === "true") meta[key] = true;
    else if (val === "false") meta[key] = false;
    else if (val === "null") meta[key] = null;
    else if (!isNaN(Number(val)) && val !== "") meta[key] = Number(val);
    else meta[key] = val;
  }

  // Parse ISO dates to epoch ms if present
  if (typeof meta.valid_from === "string" && meta.valid_from.includes("-")) {
    const parsed = Date.parse(meta.valid_from);
    if (!isNaN(parsed)) meta.valid_from = parsed;
  }
  if (typeof meta.valid_until === "string" && meta.valid_until.includes("-")) {
    const parsed = Date.parse(meta.valid_until);
    if (!isNaN(parsed)) meta.valid_until = parsed;
  }
  if (typeof meta.created_at === "string" && meta.created_at.includes("-")) {
    const parsed = Date.parse(meta.created_at);
    if (!isNaN(parsed)) meta.created_at = parsed;
  }
  if (typeof meta.updated_at === "string" && meta.updated_at.includes("-")) {
    const parsed = Date.parse(meta.updated_at);
    if (!isNaN(parsed)) meta.updated_at = parsed;
  }

  return {
    meta: {
      id: meta.id || "",
      scope: meta.scope || "global",
      category: meta.category || "fact",
      importance: meta.importance || "normal",
      structure_type: meta.structure_type || "freeform",
      tags: meta.tags || [],
      is_negative_constraint: Boolean(meta.is_negative_constraint),
      outcome: meta.outcome || "neutral",
      valid_from: meta.valid_from,
      valid_until: meta.valid_until,
      created_at: meta.created_at,
      updated_at: meta.updated_at,
    },
    content,
  };
}

/**
 * Determines appropriate subfolder for a memory category.
 */
function getCategoryFolder(category: string, isNegativeConstraint: boolean): string {
  if (isNegativeConstraint) return "rules";
  switch (category) {
    case "rule":
    case "negative_constraint":
      return "rules";
    case "preference":
      return "preferences";
    case "architecture":
    case "hardware":
      return "architecture";
    case "reflection":
      return "reflections";
    case "episodic":
      return "episodic";
    default:
      return "facts";
  }
}

/**
 * Recursively retrieves all markdown files in a directory.
 */
function walkMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of list) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Exports all active memories to a Markdown Vault directory.
 */
export function exportVault(db: Database, customDir?: string): VaultExportResult {
  const vaultDir = resolveVaultDir(customDir);
  const rows = db.query("SELECT * FROM memories WHERE is_active = 1").all() as any[];

  const byCategory: Record<string, number> = {};

  for (const r of rows) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(r.tags || "[]");
    } catch {
      tags = [];
    }

    const subFolder = getCategoryFolder(r.category, Boolean(r.is_negative_constraint));
    const targetFolder = path.join(vaultDir, subFolder);
    fs.mkdirSync(targetFolder, { recursive: true });

    const slug = slugify(r.content, 28);
    const filename = `${slug}-${r.id.slice(0, 8)}.md`;
    const filePath = path.join(targetFolder, filename);

    const frontmatter: VaultFileFrontmatter = {
      id: r.id,
      scope: r.scope,
      category: r.category,
      importance: r.importance,
      structure_type: r.structure_type,
      tags,
      is_negative_constraint: Boolean(r.is_negative_constraint),
      outcome: r.outcome,
      valid_from: r.valid_from,
      valid_until: r.valid_until,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };

    const doc = serializeFrontmatter(frontmatter, r.content);
    fs.writeFileSync(filePath, doc, "utf-8");

    try {
      const mtimeSec = Math.floor(r.updated_at / 1000);
      fs.utimesSync(filePath, mtimeSec, mtimeSec);
    } catch {
      // ignore
    }

    byCategory[subFolder] = (byCategory[subFolder] || 0) + 1;
  }


  // Create a README.md in the vault explaining the directory layout for Obsidian / VS Code users
  const readmePath = path.join(vaultDir, "README.md");
  if (!fs.existsSync(readmePath)) {
    const readmeContent = `# 🏛️ Mnemosyne Memory Vault

This folder is an active Markdown mirror of your AI Agent's long-term memory.
You can read and edit these markdown files in **Obsidian**, **VS Code**, or **Cursor**.

### Directory Structure:
- \`rules/\`: Critical anti-pattern guardrails & strict operational constraints.
- \`facts/\`: Semantic facts & declarative knowledge.
- \`preferences/\`: User working style, formatting, and worldview preferences.
- \`architecture/\`: Technical decisions, ports, databases, and hardware limits.
- \`reflections/\`: Higher-order syntheses generated by sleep dreaming.
- \`episodic/\`: Transient session context and task progress.

Changes made here can be synced back into the SQLite engine via \`mnemo vault sync\`.
`;
    fs.writeFileSync(readmePath, readmeContent, "utf-8");
  }

  return {
    vault_dir: vaultDir,
    total_exported: rows.length,
    by_category: byCategory,
    timestamp: Date.now(),
  };
}

/**
 * Imports Markdown files from a Vault directory into the SQLite database.
 */
export async function importVault(db: Database, customDir?: string): Promise<VaultImportResult> {
  const vaultDir = resolveVaultDir(customDir);
  const files = walkMarkdownFiles(vaultDir).filter((f) => !f.endsWith("README.md"));

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const now = Date.now();

  for (const filePath of files) {
    try {
      const rawText = fs.readFileSync(filePath, "utf-8");
      const { meta, content } = parseFrontmatter(rawText);
      if (!content) {
        skipped++;
        continue;
      }

      const fileMtime = fs.statSync(filePath).mtimeMs;
      const memId = meta.id || `mem_${crypto.randomUUID()}`;

      // Check if memory exists
      const existing = db.query("SELECT id, content, updated_at FROM memories WHERE id = ?").get(memId) as any;

      if (existing) {
        // If content is unchanged, skip
        if (existing.content.trim() === content.trim()) {
          skipped++;
          continue;
        }

        // If file is newer or content modified
        if (fileMtime > existing.updated_at || !meta.id) {
          const stmt = db.prepare(`
            UPDATE memories SET
              content = ?,
              scope = ?,
              category = ?,
              importance = ?,
              structure_type = ?,
              tags = ?,
              is_negative_constraint = ?,
              outcome = ?,
              valid_from = ?,
              valid_until = ?,
              updated_at = ?
            WHERE id = ?
          `);

          stmt.run(
            content,
            meta.scope || "global",
            meta.category || "fact",
            meta.importance || "normal",
            meta.structure_type || "freeform",
            JSON.stringify(meta.tags || []),
            meta.is_negative_constraint ? 1 : 0,
            meta.outcome || "neutral",
            meta.valid_from ? Number(meta.valid_from) : 0,
            meta.valid_until ? Number(meta.valid_until) : null,
            now,
            memId
          );

          // Update vector and FTS5
          const vec = await getEmbedding(content);
          db.prepare("INSERT OR REPLACE INTO memory_vectors (memory_id, vector, dimension) VALUES (?, ?, ?)")
            .run(memId, Buffer.from(vec.buffer), vec.length);

          db.prepare("DELETE FROM memory_fts WHERE memory_id = ?").run(memId);
          db.prepare("INSERT INTO memory_fts (memory_id, content, category, tags) VALUES (?, ?, ?, ?)")
            .run(memId, content, meta.category || "fact", JSON.stringify(meta.tags || []));

          recordMemoryEvent(db, memId, "MUTATED", JSON.stringify({ source: "vault_import", file: path.basename(filePath) }));
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Insert new memory
        const stmt = db.prepare(`
          INSERT INTO memories (
            id, content, scope, category, importance, structure_type,
            tags, access_count, last_accessed_at, created_at, updated_at,
            is_active, valid_from, valid_until, outcome, is_negative_constraint
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?)
        `);

        stmt.run(
          memId,
          content,
          meta.scope || "global",
          meta.category || "fact",
          meta.importance || "normal",
          meta.structure_type || "freeform",
          JSON.stringify(meta.tags || []),
          now,
          meta.created_at ? Number(meta.created_at) : now,
          now,
          meta.valid_from ? Number(meta.valid_from) : 0,
          meta.valid_until ? Number(meta.valid_until) : null,
          meta.outcome || "neutral",
          meta.is_negative_constraint ? 1 : 0
        );

        // Insert vector and FTS5
        const vec = await getEmbedding(content);
        db.prepare("INSERT OR REPLACE INTO memory_vectors (memory_id, vector, dimension) VALUES (?, ?, ?)")
          .run(memId, Buffer.from(vec.buffer), vec.length);

        db.prepare("INSERT INTO memory_fts (memory_id, content, category, tags) VALUES (?, ?, ?, ?)")
          .run(memId, content, meta.category || "fact", JSON.stringify(meta.tags || []));

        recordMemoryEvent(db, memId, "CREATED", JSON.stringify({ source: "vault_import", file: path.basename(filePath) }));
        added++;
      }
    } catch {
      skipped++;
    }
  }

  return {
    vault_dir: vaultDir,
    total_scanned: files.length,
    added,
    updated,
    skipped,
    timestamp: now,
  };
}

/**
 * Bi-directional synchronization between SQLite and Vault Markdown directory.
 */
export async function syncVault(db: Database, customDir?: string): Promise<VaultSyncResult> {
  const vaultDir = resolveVaultDir(customDir);
  fs.mkdirSync(vaultDir, { recursive: true });

  // 1. Import from files first
  const importRes = await importVault(db, vaultDir);

  // 2. Export active memories to reflect any additions/updates from DB
  const exportRes = exportVault(db, vaultDir);

  return {
    vault_dir: vaultDir,
    exported: exportRes.total_exported,
    imported: importRes.added + importRes.updated,
    conflicts_resolved: 0,
    timestamp: Date.now(),
  };
}
