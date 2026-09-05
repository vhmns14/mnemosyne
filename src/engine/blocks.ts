import type { Database } from "bun:sqlite";
import type { ContextBlockRecord } from "../types.ts";

const DEFAULT_BLOCKS: Array<{ name: string; content: string; limit: number }> = [
  {
    name: "active_task",
    content: "# Active Task\nStatus: Idle. Ready for user instructions.",
    limit: 300,
  },
  {
    name: "scratchpad",
    content: "# Working Scratchpad\nEmpty scratchpad for temporary notes and plan steps.",
    limit: 500,
  },
  {
    name: "user_profile",
    content: "# User Profile\nDeveloper working on high-performance local AI agent systems.",
    limit: 300,
  },
];

/**
 * Validates block name to prevent prototype pollution, path traversal, and malicious strings.
 */
export function validateBlockName(name: string): string {
  const clean = (name || "").trim();
  if (!clean || clean.length > 64 || !/^[a-zA-Z0-9_\-\.]+$/.test(clean)) {
    throw new Error(`Invalid block name '${name}'. Must be 1-64 alphanumeric characters, underscores, hyphens, or dots.`);
  }
  if (clean === "__proto__" || clean === "constructor" || clean === "prototype" || clean.includes("..")) {
    throw new Error(`Reserved or forbidden block name '${name}'.`);
  }
  return clean;
}

/**
 * Initializes standard default working memory blocks if they do not already exist.
 */
export function initDefaultContextBlocks(db: Database): void {
  const now = Date.now();
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO context_blocks (name, content, token_limit, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  for (const block of DEFAULT_BLOCKS) {
    insertStmt.run(block.name, block.content, block.limit, now);
  }
}

/**
 * Retrieves a dynamic context block by name.
 */
export function getContextBlock(db: Database, name: string): ContextBlockRecord | null {
  const validName = validateBlockName(name);
  initDefaultContextBlocks(db);
  const row = db
    .query("SELECT name, content, token_limit, updated_at FROM context_blocks WHERE name = ?")
    .get(validName) as any;

  if (!row) return null;
  return {
    name: row.name,
    content: row.content,
    token_limit: row.token_limit,
    updated_at: row.updated_at,
  };
}

/**
 * Creates or updates the full content of a context block.
 */
export function setContextBlock(
  db: Database,
  name: string,
  content: string,
  tokenLimit?: number
): ContextBlockRecord {
  const validName = validateBlockName(name);
  initDefaultContextBlocks(db);
  const now = Date.now();

  const existing = db
    .query("SELECT token_limit FROM context_blocks WHERE name = ?")
    .get(name) as any;

  const limit = tokenLimit || (existing ? existing.token_limit : 500);

  // Enforce token budget limit (approx 4 chars per token)
  const maxChars = limit * 4;
  let truncatedContent = content.trim();
  if (truncatedContent.length > maxChars) {
    truncatedContent = truncatedContent.slice(0, maxChars) + "\n... [truncated to fit block token budget]";
  }

  db.prepare(`
    INSERT OR REPLACE INTO context_blocks (name, content, token_limit, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(name, truncatedContent, limit, now);

  return {
    name,
    content: truncatedContent,
    token_limit: limit,
    updated_at: now,
  };
}

/**
 * Appends text to an existing context block.
 */
export function appendContextBlock(
  db: Database,
  name: string,
  textToAppend: string
): ContextBlockRecord {
  initDefaultContextBlocks(db);
  const existing = getContextBlock(db, name);

  let newContent = existing ? `${existing.content.trim()}\n${textToAppend.trim()}` : textToAppend.trim();
  const limit = existing ? existing.token_limit : 500;

  return setContextBlock(db, name, newContent, limit);
}

/**
 * Lists all active context blocks.
 */
export function listContextBlocks(db: Database): ContextBlockRecord[] {
  initDefaultContextBlocks(db);
  const rows = db
    .query("SELECT name, content, token_limit, updated_at FROM context_blocks ORDER BY name ASC")
    .all() as any[];

  return rows.map((r) => ({
    name: r.name,
    content: r.content,
    token_limit: r.token_limit,
    updated_at: r.updated_at,
  }));
}

/**
 * Deletes a custom context block.
 */
export function deleteContextBlock(db: Database, name: string): boolean {
  const validName = validateBlockName(name);
  const res = db.prepare("DELETE FROM context_blocks WHERE name = ?").run(validName);
  return res.changes > 0;
}
