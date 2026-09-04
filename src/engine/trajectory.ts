import type { Database } from "bun:sqlite";
import type { TrajectoryRecord, RecordTrajectoryOptions, CalibratedToolResult } from "../types.ts";
import { randomUUID } from "node:crypto";

/**
 * Record an execution trajectory (failed command -> error -> fix -> success)
 */
export function recordTrajectory(
  db: Database,
  options: RecordTrajectoryOptions
): TrajectoryRecord {
  const goal = options.goal.trim();
  const toolName = (options.tool_name || "shell").trim();
  const fixedCommand = options.fixed_command.trim();
  const now = Date.now();

  // Check if this exact solution already exists for this goal
  const existing = db.query(`
    SELECT * FROM trajectories 
    WHERE goal = ? AND fixed_command = ?
  `).get(goal, fixedCommand) as any;

  if (existing) {
    db.query(`
      UPDATE trajectories 
      SET success_count = success_count + 1,
          updated_at = ?,
          error_snippet = COALESCE(?, error_snippet),
          success_output_snippet = COALESCE(?, success_output_snippet)
      WHERE id = ?
    `).run(now, options.error_snippet || null, options.success_output_snippet || null, existing.id);

    return {
      ...existing,
      success_count: existing.success_count + 1,
      updated_at: now,
    };
  }

  const id = randomUUID();
  const record: TrajectoryRecord = {
    id,
    goal,
    tool_name: toolName,
    failed_command: options.failed_command || undefined,
    error_snippet: options.error_snippet || undefined,
    fixed_command: fixedCommand,
    success_output_snippet: options.success_output_snippet || undefined,
    scope: options.scope || "global",
    success_count: 1,
    created_at: now,
    updated_at: now,
  };

  db.query(`
    INSERT INTO trajectories (
      id, goal, tool_name, failed_command, error_snippet, 
      fixed_command, success_output_snippet, scope, success_count, 
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.goal,
    record.tool_name,
    record.failed_command || null,
    record.error_snippet || null,
    record.fixed_command,
    record.success_output_snippet || null,
    record.scope,
    record.success_count,
    record.created_at,
    record.updated_at
  );

  return record;
}

/**
 * Calibrate a tool execution by retrieving historical trajectory demonstrations
 */
export function calibrateTool(
  db: Database,
  query: string,
  options: { tool_name?: string; limit?: number } = {}
): CalibratedToolResult {
  const q = (query || "").trim().toLowerCase();
  const limit = options.limit || 5;

  if (!q) {
    return { has_match: false, demonstrations: [] };
  }

  // Tokenize keywords for flexible matching
  const keywords = q
    .replace(/[^a-z0-9_\-\.\/]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const allRows = db.query(`
    SELECT * FROM trajectories 
    ORDER BY success_count DESC, updated_at DESC
  `).all() as any[];

  // Score trajectories based on keyword overlap with goal, failed_command, and error_snippet
  const scored = allRows.map((r) => {
    let score = 0;
    const targetText = `${r.goal} ${r.failed_command || ""} ${r.error_snippet || ""} ${r.fixed_command}`.toLowerCase();
    
    // Direct substring bonus
    if (targetText.includes(q)) score += 10;

    // Keyword matching
    for (const kw of keywords) {
      if (targetText.includes(kw)) score += 2;
    }

    if (options.tool_name && r.tool_name === options.tool_name) {
      score += 3;
    }

    return { record: r, score };
  });

  const matches = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({
      ...s.record,
      failed_command: s.record.failed_command || undefined,
      error_snippet: s.record.error_snippet || undefined,
      success_output_snippet: s.record.success_output_snippet || undefined,
    })) as TrajectoryRecord[];

  return {
    has_match: matches.length > 0,
    demonstrations: matches,
    recommended_command: matches.length > 0 ? matches[0].fixed_command : undefined,
  };
}

/**
 * List all saved trajectories
 */
export function listTrajectories(db: Database, limit: number = 50): TrajectoryRecord[] {
  const rows = db.query(`
    SELECT * FROM trajectories 
    ORDER BY success_count DESC, updated_at DESC 
    LIMIT ?
  `).all(limit) as any[];

  return rows.map((r) => ({
    ...r,
    failed_command: r.failed_command || undefined,
    error_snippet: r.error_snippet || undefined,
    success_output_snippet: r.success_output_snippet || undefined,
  }));
}
