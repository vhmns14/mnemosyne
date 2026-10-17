import type { Database } from "bun:sqlite";
import type { MemoryScope, MemoryUsage, PromotionSuggestion, UsageVerdict } from "../types.ts";
import { recordMemoryEvent } from "./doctor.ts";

/**
 * Usage feedback (F2) + cross-project promotion (F4).
 *
 * The scoring pipeline already reserved room for outcome signals
 * (`M_outcome = 1.2`, guardrail `1.45`) but nothing ever filled them, so every
 * memory aged identically: recalled a hundred times or never, right or wrong.
 * These verdicts are what makes retrieval sharpen instead of just grow.
 */
const HELPED_CONFIDENCE_DELTA = 0.05;
const MISLED_CONFIDENCE_DELTA = -0.15;
const MIN_CONFIDENCE = 0.05;
const MAX_CONFIDENCE = 1.0;

export function usageMultiplier(usage?: MemoryUsage): number {
  if (!usage) return 1.0;
  const raw = 1 + 0.05 * usage.helped - 0.2 * usage.misled;
  return Math.min(1.5, Math.max(0.35, Number(raw.toFixed(4))));
}

function ensureUsageRow(db: Database, memoryId: string, now: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO memory_usage (memory_id, recalled, helped, misled, last_used_at)
     VALUES (?, 0, 0, 0, ?)`
  ).run(memoryId, now);
}

/**
 * Counts recall hits and attributes them to a project (provenance for F4).
 */
export function recordRecallUsage(db: Database, memoryIds: string[], project?: string | null): void {
  if (memoryIds.length === 0) return;
  const now = Date.now();

  const bump = db.prepare(
    `INSERT INTO memory_usage (memory_id, recalled, helped, misled, last_used_at)
     VALUES (?, 1, 0, 0, ?)
     ON CONFLICT(memory_id) DO UPDATE SET recalled = recalled + 1, last_used_at = excluded.last_used_at`
  );
  for (const id of memoryIds) {
    try {
      bump.run(id, now);
    } catch {
      // memory row removed underneath us — counters are best-effort
    }
  }

  if (project) recordProjectHit(db, memoryIds, project, now);
}

export function recordProjectHit(db: Database, memoryIds: string[], project: string, now: number = Date.now()): void {
  if (!project) return;
  const stmt = db.prepare(
    `INSERT INTO memory_project_hits (memory_id, project, hits, last_seen_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(memory_id, project) DO UPDATE SET hits = hits + 1, last_seen_at = excluded.last_seen_at`
  );
  for (const id of memoryIds) {
    try {
      stmt.run(id, project, now);
    } catch {
      // ignore orphan hits
    }
  }
}

/**
 * Records a helped/misled verdict, moving `confidence` so future recalls rank
 * the memory up (proven useful) or down (proven misleading).
 */
export function rateMemory(
  db: Database,
  memoryId: string,
  verdict: UsageVerdict,
  note?: string,
  project?: string | null
): MemoryUsage | null {
  const now = Date.now();
  const row = db.query("SELECT id, confidence FROM memories WHERE id = ?").get(memoryId) as
    | { id: string; confidence: number | null }
    | null;
  if (!row) return null;

  ensureUsageRow(db, memoryId, now);
  const column = verdict === "helped" ? "helped" : "misled";
  db.prepare(
    `UPDATE memory_usage SET ${column} = ${column} + 1, last_used_at = ?, note = COALESCE(?, note) WHERE memory_id = ?`
  ).run(now, note ?? null, memoryId);

  const delta = verdict === "helped" ? HELPED_CONFIDENCE_DELTA : MISLED_CONFIDENCE_DELTA;
  const confidence = Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, (row.confidence ?? 1.0) + delta));
  const accessBump = verdict === "helped" ? 1 : 0;
  db.prepare(
    `UPDATE memories SET confidence = ?, access_count = access_count + ?, updated_at = ? WHERE id = ?`
  ).run(confidence, accessBump, now, memoryId);

  recordMemoryEvent(db, memoryId, "MUTATED", `Usage verdict: ${verdict}${note ? ` (${note})` : ""}`, "feedback");
  if (project) recordProjectHit(db, [memoryId], project, now);

  return getMemoryUsage(db, memoryId);
}

export function getMemoryUsage(db: Database, memoryId: string): MemoryUsage | null {
  const row = db.query("SELECT * FROM memory_usage WHERE memory_id = ?").get(memoryId) as
    | (MemoryUsage & { memory_id: string })
    | null;
  return row ? { ...row } : null;
}

export function getUsageMap(db: Database, memoryIds: string[]): Map<string, MemoryUsage> {
  const map = new Map<string, MemoryUsage>();
  if (memoryIds.length === 0) return map;

  const placeholders = memoryIds.map(() => "?").join(",");
  const rows = db
    .query(`SELECT * FROM memory_usage WHERE memory_id IN (${placeholders})`)
    .all(...memoryIds) as Array<MemoryUsage & { memory_id: string }>;
  for (const row of rows) map.set(row.memory_id, { ...row });
  return map;
}

/**
 * Facts that proved themselves in several projects should stop hiding inside
 * one workspace: a new repo should inherit "never run parallel builds", not
 * rediscover it.
 */
export function suggestPromotions(db: Database, minProjects: number = 3, limit: number = 20): PromotionSuggestion[] {
  const rows = db
    .query(
      `SELECT h.memory_id,
              COUNT(*) AS project_count,
              GROUP_CONCAT(h.project) AS projects,
              COALESCE(u.helped, 0) AS helped,
              m.content,
              m.scope
       FROM memory_project_hits h
       JOIN memories m ON m.id = h.memory_id
       LEFT JOIN memory_usage u ON u.memory_id = h.memory_id
       WHERE m.is_active = 1 AND m.scope != 'global'
       GROUP BY h.memory_id
       HAVING COUNT(*) >= ?
       ORDER BY project_count DESC, helped DESC
       LIMIT ?`
    )
    .all(minProjects, limit) as Array<{
    memory_id: string;
    project_count: number;
    projects: string;
    helped: number;
    content: string;
    scope: MemoryScope;
  }>;

  return rows.map((row) => {
    const projects = (row.projects || "").split(",").filter(Boolean);
    return {
      memory_id: row.memory_id,
      content: row.content,
      scope: row.scope,
      projects,
      project_count: row.project_count,
      helped: row.helped,
      reason: `Used in ${row.project_count} projects (${projects.join(", ")}) and rated helped ${row.helped}x — promote so new workspaces inherit it.`,
    };
  });
}

export function promoteMemory(db: Database, memoryId: string, to: MemoryScope = "global"): boolean {
  const now = Date.now();
  const res = db
    .prepare(`UPDATE memories SET scope = ?, updated_at = ? WHERE id = ? AND is_active = 1`)
    .run(to, now, memoryId);
  if (res.changes === 0) return false;

  recordMemoryEvent(db, memoryId, "MUTATED", `Scope promoted to '${to}'`, "promotion");
  return true;
}
