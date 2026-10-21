import type { Database } from "bun:sqlite";
import { CONFIG } from "../config.ts";
import { computeFingerprint } from "./dialectic.ts";
import { getEmbedding, cosineSimilarity, decodeVector } from "./embedder.ts";
import {
  addDerivedFact,
  cardFacts,
  getFactRow,
  normalizeCategory,
  normalizeKind,
  reinforceFact,
  supersedeFact,
  type DerivedCategory,
  type FactKind,
} from "./facts.ts";
import { LlmClient, type ChatMessage } from "./llm.ts";
import { claimBatch, completeBatch, failBatch, queueStats, type MessageRow } from "./messages.ts";
import { redactSecrets } from "./redact.ts";
import { refreshRepresentation, upsertSessionSummary, getSessionSummary } from "./representation.ts";
import { reflectPeer } from "./insights.ts";

/**
 * Deriver: turns queued conversation messages into facts about the peer.
 *
 *   claim batch (per peer) -> redact -> LLM extract (facts + session summaries)
 *   -> Mem0-style decision vs top-k similar facts (ADD / UPDATE / DELETE / NOOP)
 *   -> write through rememberMemory (dedupe + triple conflicts) with provenance
 *   -> refresh representation -> periodic reflect.
 *
 * All LLM calls happen before any write, so a failed call leaves the store
 * untouched and the batch goes back on the queue with backoff.
 */

export interface Candidate {
  content: string;
  kind: FactKind;
  category: DerivedCategory;
  confidence: number;
  source_message_ids: number[];
  entities?: Array<{ subject: string; predicate: string; object: string }>;
}

export type DecisionAction = "ADD" | "UPDATE" | "DELETE" | "NOOP";

export interface BatchReport {
  peer: string;
  messages: number;
  candidates: number;
  added: number;
  updated: number;
  deleted: number;
  noop: number;
  fact_ids: string[];
  sessions: string[];
}

const PREDICATES = "LIKES, DISLIKES, PREFERS, REJECTS, WANTS, USES, NEEDS, LIVES_IN, WORKS_AT, WORKS_ON, HAS_GOAL, HAS_HABIT, SPEAKS, OWNS";

export function setMeta(db: Database, key: string, value: string): void {
  db.prepare(`INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(
    key,
    value,
    Date.now()
  );
}

export function getMeta(db: Database, key: string): string | null {
  return ((db.query(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | null)?.value) ?? null;
}

function extractionPrompt(peer: string, messages: MessageRow[], known: string[], summaries: Record<string, string>): ChatMessage[] {
  const transcript = messages
    .map((m) => `[#${m.id}] (${m.session}) ${m.role === "user" ? peer : m.role}: ${redactSecrets(m.content).text}`)
    .join("\n");
  const prev = Object.entries(summaries)
    .map(([s, t]) => `${s}: ${t}`)
    .join("\n");
  return [
    {
      role: "system",
      content: [
        `You extract durable knowledge about the person "${peer}" from a conversation between them and an AI assistant.`,
        `Return ONLY facts about ${peer} (not about the assistant, not general world knowledge, not transient chit-chat).`,
        `- "explicit": stated directly by ${peer}. "deductive": a conclusion that follows with high certainty from what they said.`,
        `- category: profile (identity, goals, habits, constraints), preferences, entities (projects, people, tools, places in their life), events (dated plans/happenings), cases (problems they had and how they were solved), patterns (recurring behaviour).`,
        `- Write each fact as one short third-person sentence naming ${peer}, e.g. "${peer} prefers TypeScript over Python".`,
        `- confidence 0..1. source_message_ids: the [#id] numbers the fact comes from.`,
        `- Optional triple (subject, predicate, object) with predicate from: ${PREDICATES}.`,
        `- Never include secrets, passwords, keys or text marked [REDACTED].`,
        `Also update a 1-3 sentence running summary for each session that appears.`,
        `Reply as JSON: {"facts":[{"content":"","kind":"explicit","category":"profile","confidence":0.9,"source_message_ids":[1],"subject":"","predicate":"","object":""}],"session_summaries":{"<session>":"..."}}`,
        `Return {"facts":[],"session_summaries":{...}} when nothing durable was said.`,
      ].join("\n"),
    },
    {
      role: "user",
      content: `Already known about ${peer}:\n${known.length ? known.map((k) => `- ${k}`).join("\n") : "(nothing yet)"}\n\nPrevious session summaries:\n${prev || "(none)"}\n\nNew messages:\n${transcript}`,
    },
  ];
}

export function parseCandidates(raw: any, batchIds: Set<number>, userIds: number[]): Candidate[] {
  const facts = Array.isArray(raw?.facts) ? raw.facts : [];
  const out: Candidate[] = [];
  for (const f of facts.slice(0, 40)) {
    if (!f || typeof f.content !== "string") continue;
    const content = redactSecrets(f.content.trim()).text.slice(0, 600);
    if (content.length < 4 || /\[REDACTED/.test(content)) continue;
    let ids = Array.isArray(f.source_message_ids) ? f.source_message_ids.map(Number).filter((n: number) => batchIds.has(n)) : [];
    if (ids.length === 0) ids = userIds;
    const conf = Number(f.confidence);
    const entities =
      typeof f.subject === "string" && typeof f.predicate === "string" && typeof f.object === "string" && f.subject && f.predicate && f.object
        ? [{ subject: f.subject.slice(0, 100), predicate: f.predicate.slice(0, 40), object: f.object.slice(0, 200) }]
        : undefined;
    out.push({
      content,
      kind: normalizeKind(f.kind) === "deductive" ? "deductive" : "explicit",
      category: normalizeCategory(f.category),
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.7,
      source_message_ids: Array.from(new Set(ids as number[])),
      entities,
    });
  }
  return out;
}

interface Neighbor {
  id: string;
  content: string;
  sim: number;
}

/** Top-k similar active facts for this peer (exact fingerprint first, then embedding cosine). */
export async function similarFacts(db: Database, peer: string, content: string, k = 5, minSim = 0.3): Promise<Neighbor[]> {
  const fp = computeFingerprint(content);
  const rows = db
    .query(
      `SELECT m.id, m.content, m.fingerprint, v.vector FROM derived_facts d
       JOIN memories m ON m.id = d.memory_id LEFT JOIN memory_vectors v ON v.memory_id = m.id
       WHERE d.peer = ? AND m.is_active = 1 ORDER BY d.updated_at DESC LIMIT 2000`
    )
    .all(peer) as Array<{ id: string; content: string; fingerprint: string; vector: any }>;
  if (rows.length === 0) return [];
  const exact = rows.find((r) => r.fingerprint === fp);
  if (exact) return [{ id: exact.id, content: exact.content, sim: 1 }];
  const qv = await getEmbedding(content);
  const scored: Neighbor[] = [];
  for (const r of rows) {
    const v = decodeVector(r.vector);
    if (!v) continue;
    const sim = cosineSimilarity(qv, v);
    if (sim >= minSim) scored.push({ id: r.id, content: r.content, sim });
  }
  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, k);
}

function decisionPrompt(peer: string, items: Array<{ index: number; candidate: Candidate; neighbors: Neighbor[] }>): ChatMessage[] {
  const body = items
    .map(
      (it) =>
        `Candidate ${it.index}: ${it.candidate.content}\n  Existing:\n${it.neighbors.map((n) => `   - id=${n.id}: ${n.content}`).join("\n")}`
    )
    .join("\n\n");
  return [
    {
      role: "system",
      content: [
        `You maintain a memory of facts about "${peer}". For each candidate fact decide against the similar existing facts:`,
        `ADD: new information not covered by any existing fact.`,
        `UPDATE <id>: same subject as an existing fact but adds detail or is a refinement; give the merged sentence in "content".`,
        `DELETE <id>: the candidate contradicts that existing fact (it is no longer true); the candidate will be stored instead.`,
        `NOOP <id>: already known (same meaning) — nothing new.`,
        `Reply as JSON: {"decisions":[{"index":0,"action":"ADD|UPDATE|DELETE|NOOP","target_id":"<existing id or empty>","content":"<merged text for UPDATE>"}]}`,
      ].join("\n"),
    },
    { role: "user", content: body },
  ];
}

export async function deriveBatch(db: Database, llm: LlmClient, peer: string, messages: MessageRow[]): Promise<BatchReport> {
  const report: BatchReport = { peer, messages: messages.length, candidates: 0, added: 0, updated: 0, deleted: 0, noop: 0, fact_ids: [], sessions: [] };
  const sessions = Array.from(new Set(messages.map((m) => m.session)));
  report.sessions = sessions;
  const prevSummaries: Record<string, string> = {};
  for (const s of sessions) {
    const prev = getSessionSummary(db, peer, s);
    if (prev) prevSummaries[s] = prev.summary;
  }
  const known = cardFacts(db, peer, 20).map((f) => f.content);

  // ---- LLM call 1: extraction (+ session summaries)
  const raw = await llm.chatJSON(extractionPrompt(peer, messages, known, prevSummaries));
  const batchIds = new Set(messages.map((m) => m.id));
  const userIds = messages.filter((m) => m.role === "user").map((m) => m.id);
  const candidates = parseCandidates(raw, batchIds, userIds.length ? userIds : [...batchIds]);
  report.candidates = candidates.length;

  // ---- Mem0 decision: deterministic where obvious, one LLM call for the ambiguous rest
  type Planned = { candidate: Candidate; action: DecisionAction; target?: string; content?: string };
  const planned: Planned[] = [];
  const ambiguous: Array<{ index: number; candidate: Candidate; neighbors: Neighbor[] }> = [];
  for (const c of candidates) {
    const neighbors = await similarFacts(db, peer, c.content);
    if (neighbors.length === 0) planned.push({ candidate: c, action: "ADD" });
    else if (neighbors[0].sim >= 0.999) planned.push({ candidate: c, action: "NOOP", target: neighbors[0].id });
    else ambiguous.push({ index: ambiguous.length, candidate: c, neighbors });
  }
  if (ambiguous.length) {
    const reply = await llm.chatJSON<{ decisions?: any[] }>(decisionPrompt(peer, ambiguous));
    const decisions = Array.isArray(reply?.decisions) ? reply.decisions : [];
    for (const item of ambiguous) {
      const d = decisions.find((x) => Number(x?.index) === item.index);
      const action = String(d?.action ?? "").toUpperCase().split(/\s+/)[0] as DecisionAction;
      const target = typeof d?.target_id === "string" ? d.target_id.trim() : String(d?.action ?? "").split(/\s+/)[1];
      const validTarget = item.neighbors.some((n) => n.id === target) ? target : undefined;
      if ((action === "UPDATE" || action === "DELETE" || action === "NOOP") && validTarget) {
        planned.push({ candidate: item.candidate, action, target: validTarget, content: typeof d?.content === "string" ? d.content : undefined });
      } else if (item.neighbors[0].sim >= 0.92) {
        planned.push({ candidate: item.candidate, action: "NOOP", target: item.neighbors[0].id });
      } else {
        planned.push({ candidate: item.candidate, action: "ADD" });
      }
    }
  }

  // ---- writes (no LLM from here on)
  const session = messages[messages.length - 1]?.session ?? null;
  for (const p of planned) {
    const c = p.candidate;
    const base = {
      peer,
      kind: c.kind,
      category: c.category,
      confidence: c.confidence,
      source_message_ids: c.source_message_ids,
      session,
      entities: c.entities,
    };
    if (p.action === "NOOP" && p.target) {
      reinforceFact(db, p.target, c.source_message_ids);
      report.noop++;
      continue;
    }
    if ((p.action === "UPDATE" || p.action === "DELETE") && p.target) {
      const old = getFactRow(db, p.target);
      supersedeFact(
        db,
        p.target,
        null,
        p.action === "UPDATE" ? `Refined by newer evidence (messages ${c.source_message_ids.join(",")})` : `Contradicted by newer evidence (messages ${c.source_message_ids.join(",")})`
      );
      const content = p.action === "UPDATE" && p.content?.trim() ? redactSecrets(p.content.trim()).text.slice(0, 600) : c.content;
      const res = await addDerivedFact(db, {
        ...base,
        content,
        source_message_ids: p.action === "UPDATE" && old ? Array.from(new Set([...old.source_message_ids, ...c.source_message_ids])) : c.source_message_ids,
        source_memory_ids: [p.target],
        trust: p.action === "UPDATE" && old ? Math.max(0.5, old.trust) : undefined,
      });
      db.prepare(`UPDATE memories SET superseded_by_id = ? WHERE id = ?`).run(res.id, p.target);
      report.fact_ids.push(res.id);
      if (p.action === "UPDATE") report.updated++;
      else report.deleted++;
      continue;
    }
    const res = await addDerivedFact(db, base.entities ? { ...base, content: c.content } : { ...base, content: c.content, entities: undefined });
    report.fact_ids.push(res.id);
    if (res.action === "added") report.added++;
    else report.noop++;
  }

  const summaries = raw?.session_summaries && typeof raw.session_summaries === "object" ? raw.session_summaries : {};
  for (const s of sessions) {
    const text = summaries[s];
    if (typeof text === "string" && text.trim()) {
      upsertSessionSummary(db, peer, s, redactSecrets(text.trim()).text, messages.filter((m) => m.session === s).length);
    }
  }
  return report;
}

export interface DeriveRunResult {
  batches: BatchReport[];
  failed: number;
  error: string | null;
  skipped_reason?: string;
}

/** Processes due batches until the queue is drained, an error occurs, or maxBatches is hit. */
export async function runDeriverOnce(db: Database, llm: LlmClient | null, opts: { maxBatches?: number; batchSize?: number } = {}): Promise<DeriveRunResult> {
  const result: DeriveRunResult = { batches: [], failed: 0, error: null };
  setMeta(db, "deriver.last_run_at", String(Date.now()));
  if (!llm) {
    const pending = queueStats(db).pending;
    result.skipped_reason = "LLM not configured (set MNEMO_LLM_URL)";
    if (pending > 0) setMeta(db, "deriver.last_error", result.skipped_reason);
    return result;
  }
  const max = opts.maxBatches ?? 10;
  const touchedPeers = new Set<string>();
  for (let i = 0; i < max; i++) {
    const batch = claimBatch(db, opts.batchSize ?? CONFIG.DERIVER_BATCH);
    if (!batch) break;
    try {
      const report = await deriveBatch(db, llm, batch.peer, batch.messages);
      completeBatch(db, batch.messages.map((m) => m.id));
      result.batches.push(report);
      if (report.added + report.updated + report.deleted > 0) touchedPeers.add(batch.peer);
      const total = Number(getMeta(db, "deriver.facts_written_total") ?? "0") + report.added + report.updated + report.deleted;
      setMeta(db, "deriver.facts_written_total", String(total));
      setMeta(db, "deriver.last_success_at", String(Date.now()));
      db.prepare(
        `INSERT INTO peer_representations (peer, updated_at, facts_since_reflect) VALUES (?, ?, ?)
         ON CONFLICT(peer) DO UPDATE SET facts_since_reflect = facts_since_reflect + excluded.facts_since_reflect`
      ).run(batch.peer, 0, report.added + report.updated + report.deleted);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      failBatch(db, batch.messages.map((m) => m.id), msg);
      result.failed++;
      result.error = msg;
      setMeta(db, "deriver.last_error", msg.slice(0, 500));
      setMeta(db, "deriver.last_error_at", String(Date.now()));
      break; // endpoint is probably down: let backoff do its job
    }
  }
  for (const peer of touchedPeers) {
    await refreshRepresentation(db, peer, llm);
    const row = db.query(`SELECT facts_since_reflect FROM peer_representations WHERE peer = ?`).get(peer) as { facts_since_reflect: number } | null;
    if (row && CONFIG.REFLECT_EVERY_FACTS > 0 && row.facts_since_reflect >= CONFIG.REFLECT_EVERY_FACTS) {
      try {
        await reflectPeer(db, peer, llm);
      } catch {
        // reflection is opportunistic
      }
    }
  }
  if (!result.error && result.batches.length) setMeta(db, "deriver.last_error", "");
  return result;
}

export interface DeriverStatus {
  enabled: boolean;
  running: boolean;
  interval_ms: number;
  queue: ReturnType<typeof queueStats>;
  last_run_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  last_error_at: number | null;
  facts_written_total: number;
  llm: { configured: boolean; url: string | null; model: string | null };
}

export function deriverStatus(db: Database, llm: LlmClient | null, extra: { enabled?: boolean; running?: boolean; interval_ms?: number } = {}): DeriverStatus {
  const num = (k: string) => {
    const v = getMeta(db, k);
    return v ? Number(v) : null;
  };
  const d = llm?.describe();
  return {
    enabled: extra.enabled ?? false,
    running: extra.running ?? false,
    interval_ms: extra.interval_ms ?? CONFIG.DERIVER_INTERVAL_MS,
    queue: queueStats(db),
    last_run_at: num("deriver.last_run_at"),
    last_success_at: num("deriver.last_success_at"),
    last_error: getMeta(db, "deriver.last_error") || null,
    last_error_at: num("deriver.last_error_at"),
    facts_written_total: num("deriver.facts_written_total") ?? 0,
    // Never the key.
    llm: { configured: Boolean(llm), url: d?.url ?? null, model: d?.model ?? null },
  };
}

/** Background loop used inside the daemon. One tick at a time; kick() runs one soon. */
export class DeriverWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private kicked: ReturnType<typeof setTimeout> | null = null;

  constructor(private db: Database, private llmFactory: () => LlmClient | null = () => LlmClient.fromEnv(), private intervalMs = CONFIG.DERIVER_INTERVAL_MS) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    (this.timer as any).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.kicked) clearTimeout(this.kicked);
    this.timer = null;
    this.kicked = null;
  }

  kick(delayMs = 50): void {
    if (this.kicked) return;
    this.kicked = setTimeout(() => {
      this.kicked = null;
      void this.tick();
    }, delayMs);
  }

  get running(): boolean {
    return this.busy;
  }

  get started(): boolean {
    return this.timer !== null;
  }

  async tick(): Promise<DeriveRunResult | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      return await runDeriverOnce(this.db, this.llmFactory());
    } catch (err) {
      setMeta(this.db, "deriver.last_error", String((err as Error)?.message ?? err).slice(0, 500));
      return null;
    } finally {
      this.busy = false;
    }
  }

  status(): DeriverStatus {
    return deriverStatus(this.db, this.llmFactory(), { enabled: this.started, running: this.busy, interval_ms: this.intervalMs });
  }
}
