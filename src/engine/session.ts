import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  SessionBrief,
  SessionEndOptions,
  SessionEndResult,
  SessionRecord,
  SessionStartOptions,
} from "../types.ts";
import { generateSessionPrimer } from "./primer.ts";
import { rollupSessionMemories } from "./rollup.ts";

/**
 * Session lifecycle (F1).
 *
 * Closes the gap that kept memories orphaned: until now `source_session` was a
 * free-form string with no row behind it, so nothing could roll a session up,
 * resume it, or tell the next session what happened in the last one.
 */
const ACTIVE_SESSION_KEY = "active_session_id";

function readMeta(db: Database, key: string): string | null {
  try {
    const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function writeMeta(db: Database, key: string, value: string | null): void {
  const now = Date.now();
  if (value === null) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, value, now);
}

export function getActiveSessionId(db: Database): string | null {
  const fromEnv = process.env.MNEMO_SESSION_ID?.trim();
  if (fromEnv) return fromEnv;
  return readMeta(db, ACTIVE_SESSION_KEY);
}

export function setActiveSessionId(db: Database, sessionId: string | null): void {
  writeMeta(db, ACTIVE_SESSION_KEY, sessionId);
}

function deriveProject(cwd?: string | null, explicit?: string | null): string | null {
  if (explicit) return explicit;
  if (!cwd) return null;
  const name = basename(cwd.replace(/\/+$/, ""));
  return name || null;
}

export function startSession(db: Database, options: SessionStartOptions = {}): SessionRecord {
  const now = Date.now();
  const cwd = options.cwd || process.cwd();

  // Close whatever session was still open instead of leaving two "active" rows.
  const previous = getActiveSession(db);
  if (previous) {
    db.prepare("UPDATE sessions SET status = 'abandoned', ended_at = ? WHERE id = ?").run(now, previous.id);
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, goal, cwd, project, peer, model, started_at, status, outcome, memory_writes, recall_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'neutral', 0, 0)`
  ).run(
    id,
    options.name ?? null,
    options.goal ?? "",
    cwd,
    deriveProject(cwd, options.project),
    options.peer ?? "user",
    options.model ?? process.env.MNEMO_MODEL ?? null,
    now
  );

  setActiveSessionId(db, id);
  return getSession(db, id)!;
}

export function getSession(db: Database, sessionId: string): SessionRecord | null {
  const row = db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRecord | null;
  return row ? { ...row } : null;
}

export function getActiveSession(db: Database): SessionRecord | null {
  const id = getActiveSessionId(db);
  if (!id) return null;
  const row = getSession(db, id);
  return row && row.status === "active" ? row : null;
}

export function listSessions(db: Database, limit: number = 10): SessionRecord[] {
  return db
    .query("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?")
    .all(limit) as SessionRecord[];
}

export async function endSession(db: Database, options: SessionEndOptions = {}): Promise<SessionEndResult> {
  const now = Date.now();
  const targetId = options.session_id || getActiveSessionId(db);
  const session = targetId ? getSession(db, targetId) : null;
  if (!session) throw new Error("No active session to end. Start one with 'mnemo session start'.");

  let rolledUp = 0;
  let macroMemoryId: string | null = null;

  if (options.rollup !== false) {
    const result = await rollupSessionMemories(db, { session_id: session.id });
    rolledUp = result.rolled_up_count;
    macroMemoryId = result.macro_memory_id || null;
  }

  const summary = options.summary ?? buildAutoSummary(db, session, rolledUp);
  db.prepare(
    `UPDATE sessions SET ended_at = ?, status = 'ended', summary = ?, outcome = ?, rollup_memory_id = ? WHERE id = ?`
  ).run(now, summary, options.outcome ?? session.outcome ?? "neutral", macroMemoryId, session.id);

  if (getActiveSessionId(db) === session.id) setActiveSessionId(db, null);

  return {
    session: getSession(db, session.id)!,
    rolled_up: rolledUp,
    macro_memory_id: macroMemoryId,
  };
}

function buildAutoSummary(db: Database, session: SessionRecord, rolledUp: number): string {
  const writes = db
    .query("SELECT COUNT(*) AS c FROM memories WHERE source_session = ?")
    .get(session.id) as { c: number };
  const guardrails = db
    .query(
      "SELECT COUNT(*) AS c FROM memories WHERE source_session = ? AND is_negative_constraint = 1"
    )
    .get(session.id) as { c: number };

  return [
    `Goal: ${session.goal || "(unstated)"}`,
    `Memories written: ${writes.c} (${guardrails.c} guardrails)`,
    `Recalls: ${session.recall_count}`,
    `Rolled up: ${rolledUp} micro-items${rolledUp > 0 ? "" : " (nothing to condense)"}`,
  ].join(" | ");
}

/** Bumps counters for the open session so the summary reflects real activity. */
export function touchSession(db: Database, kind: "write" | "recall"): void {
  const id = getActiveSessionId(db);
  if (!id) return;
  const column = kind === "write" ? "memory_writes" : "recall_count";
  try {
    db.prepare(`UPDATE sessions SET ${column} = ${column} + 1 WHERE id = ? AND status = 'active'`).run(id);
  } catch {
    // session bookkeeping must never break a memory write
  }
}

export function getSessionBrief(db: Database, options: { workspacePath?: string } = {}): SessionBrief {
  const primer = generateSessionPrimer(db, { workspacePath: options.workspacePath });
  const active = getActiveSession(db);

  const previousRow = active
    ? db
        .query("SELECT * FROM sessions WHERE id != ? AND status = 'ended' ORDER BY ended_at DESC LIMIT 1")
        .get(active.id)
    : db.query("SELECT * FROM sessions WHERE status = 'ended' ORDER BY ended_at DESC LIMIT 1").get();
  const previous = (previousRow as SessionRecord | null) ?? null;

  const lines: string[] = [primer.markdown, ""];

  lines.push("### ▶️ Current Session");
  if (active) {
    lines.push(`- **Session:** \`${active.id}\`${active.name ? ` (${active.name})` : ""}`);
    lines.push(`- **Goal:** ${active.goal || "(unstated)"}`);
    lines.push(`- **Project:** ${active.project || "(unknown)"} • writes: ${active.memory_writes} • recalls: ${active.recall_count}`);
  } else {
    lines.push("- No open session. Start one with `mnemo session start --goal \"...\"`.");
  }
  lines.push("");

  lines.push("### 🔁 Previous Session");
  if (previous) {
    lines.push(`- **Goal:** ${previous.goal || "(unstated)"} • *ended:* ${new Date(previous.ended_at ?? previous.started_at).toISOString()}`);
    lines.push(`- **Outcome:** ${previous.outcome}`);
    if (previous.summary) lines.push(`- **Summary:** ${previous.summary}`);
  } else {
    lines.push("- No finished session on record yet.");
  }
  lines.push("");
  lines.push("*(Session brief via Mnemosyne. Pick up the previous goal before re-deriving it.)*");

  return {
    markdown: lines.join("\n"),
    session: active,
    previous,
    guardrails_count: primer.guardrails_count,
    open_blockers: primer.blockers_count,
  };
}
