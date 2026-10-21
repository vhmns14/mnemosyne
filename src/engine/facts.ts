import { insightCardMinTrust } from "./insight_quality.ts";
import type { Database } from "bun:sqlite";
import type { MemoryCategory, PurgeReceipt } from "../types.ts";
import { rememberMemory } from "./dialectic.ts";
import { recordMemoryEvent, cryptographicPurge } from "./doctor.ts";
import { rateMemory } from "./feedback.ts";
import { getMessagesByIds, type MessageRow } from "./messages.ts";

/**
 * Derived facts about a peer: provenance (source message ids), trust scoring,
 * OpenViking-style categories and tiered (L0/L1/L2) rendering. Facts are stored
 * as ordinary `memories` rows so every existing engine path (hybrid recall,
 * fingerprint/semantic dedupe, triple conflict resolution, purge) applies.
 */

export const DERIVED_CATEGORIES = ["profile", "preferences", "entities", "events", "cases", "patterns"] as const;
export type DerivedCategory = (typeof DERIVED_CATEGORIES)[number];
export const FACT_KINDS = ["explicit", "deductive", "conclusion", "insight", "manual"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const TRUST_DEFAULT = 0.5;
/** A deductive conclusion starts a little below what the person said outright. */
export const TRUST_DEDUCTIVE = 0.45;
/** Only assistant/tool messages back it: kept for review, below card trust. */
export const TRUST_UNSOURCED = 0.3;
/** Would have overridden a hand-set fact: kept alongside it, below card trust. */
export const TRUST_CONFLICT = 0.4;
/**
 * Predicates where a new object replaces the old one for the same peer.
 * Everything else (habits, goals, projects, pets...) accumulates.
 */
export const SINGLE_VALUED_PREDICATES = ["LIVES_IN", "WORKS_AT", "HAS_AGE", "AGE", "IS_MARRIED_TO", "MARRIED_TO"];
export const TRUST_HELPFUL = 0.05;
export const TRUST_UNHELPFUL = -0.1;
export const TRUST_REOBSERVED = 0.03;
export const CARD_MIN_TRUST = 0.45;
export const CARD_MIN_CONFIDENCE = 0.5;

const MEMORY_CATEGORY: Record<DerivedCategory, MemoryCategory> = {
  profile: "fact",
  preferences: "preference",
  entities: "fact",
  events: "fact",
  cases: "fact",
  patterns: "reflection",
};

export function normalizeCategory(raw: unknown): DerivedCategory {
  const s = String(raw ?? "").toLowerCase().trim();
  if ((DERIVED_CATEGORIES as readonly string[]).includes(s)) return s as DerivedCategory;
  if (/prefer|like|taste|style/.test(s)) return "preferences";
  if (/goal|habit|constraint|identity|bio|personal/.test(s)) return "profile";
  if (/project|person|people|place|org|tool|entity/.test(s)) return "entities";
  if (/event|date|plan|schedule/.test(s)) return "events";
  if (/case|problem|fix|solution|incident/.test(s)) return "cases";
  if (/pattern|insight|routine/.test(s)) return "patterns";
  return "profile";
}

export function normalizeKind(raw: unknown, fallback: FactKind = "explicit"): FactKind {
  const s = String(raw ?? "").toLowerCase().trim();
  if ((FACT_KINDS as readonly string[]).includes(s)) return s as FactKind;
  if (s.startsWith("deduc") || s === "inferred") return "deductive";
  return fallback;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const parseIds = <T>(raw: string | null | undefined): T[] => {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export interface FactRow {
  id: string;
  peer: string;
  content: string;
  kind: FactKind;
  category: DerivedCategory;
  trust: number;
  confidence: number;
  observations: number;
  source_message_ids: number[];
  source_memory_ids: string[];
  status: string;
  is_active: boolean;
  superseded_by_id: string | null;
  source_session: string | null;
  /** Epoch ms after which a temporary fact stops being true (null = lasting). */
  valid_until: number | null;
  created_at: number;
  updated_at: number;
}

const isExpired = (validUntil: unknown, now = Date.now()) => validUntil !== null && validUntil !== undefined && Number(validUntil) > 0 && Number(validUntil) <= now;

function toFact(r: any): FactRow {
  return {
    id: r.id,
    peer: r.df_peer ?? r.peer,
    content: r.content,
    kind: r.kind,
    category: r.df_category ?? r.category,
    trust: Number(r.trust),
    confidence: Number(r.confidence),
    observations: Number(r.observations),
    source_message_ids: parseIds<number>(r.source_message_ids),
    source_memory_ids: parseIds<string>(r.source_memory_ids),
    status: isExpired(r.valid_until) && r.status === "active" ? "expired" : r.status,
    is_active: Boolean(r.is_active) && !isExpired(r.valid_until),
    superseded_by_id: r.superseded_by_id ?? null,
    source_session: r.source_session ?? null,
    valid_until: r.valid_until ?? null,
    created_at: Number(r.df_created_at ?? r.created_at),
    updated_at: Number(r.df_updated_at ?? r.updated_at),
  };
}

const FACT_SELECT = `
  SELECT m.id, m.content, m.confidence, m.status, m.is_active, m.superseded_by_id, m.source_session, m.valid_until,
         d.peer AS df_peer, d.kind, d.category AS df_category, d.trust, d.observations,
         d.source_message_ids, d.source_memory_ids, d.created_at AS df_created_at, d.updated_at AS df_updated_at
  FROM derived_facts d JOIN memories m ON m.id = d.memory_id
`;

export function getFactRow(db: Database, id: string): FactRow | null {
  const r = db.query(`${FACT_SELECT} WHERE d.memory_id = ?`).get(id);
  return r ? toFact(r) : null;
}

export interface NewFact {
  peer: string;
  content: string;
  kind?: FactKind;
  category?: DerivedCategory;
  confidence?: number;
  trust?: number;
  source_message_ids?: number[];
  source_memory_ids?: string[];
  session?: string | null;
  entities?: Array<{ subject: string; predicate: string; object: string }>;
  actor?: string;
  /** Epoch ms after which the fact stops being true (temporary facts). */
  valid_until?: number | null;
  /** false: a dedupe hit is not counted as re-observation (no trust nudge). */
  reinforce?: boolean;
}

export interface FactWriteResult {
  id: string;
  action: "added" | "reinforced";
}

function union<T>(a: T[], b: T[]): T[] {
  return Array.from(new Set([...a, ...b]));
}

/**
 * Re-observation: more evidence for an existing fact raises trust a little.
 * Idempotent per evidence: when every source message (and memory) is already
 * attached — a retried or re-claimed batch re-deriving the same fact — nothing
 * changes, so a crash/retry loop can never inflate trust. Returns whether it counted.
 */
export function reinforceFact(db: Database, id: string, sourceMessageIds: number[] = [], sourceMemoryIds: string[] = []): boolean {
  const row = db.query(`SELECT * FROM derived_facts WHERE memory_id = ?`).get(id) as any;
  if (!row) return false;
  const haveMsgs = parseIds<number>(row.source_message_ids);
  const haveMems = parseIds<string>(row.source_memory_ids);
  const newMsgs = sourceMessageIds.filter((m) => !haveMsgs.includes(m));
  const newMems = sourceMemoryIds.filter((m) => !haveMems.includes(m));
  if ((sourceMessageIds.length > 0 || sourceMemoryIds.length > 0) && newMsgs.length === 0 && newMems.length === 0) return false;
  const now = Date.now();
  db.prepare(
    `UPDATE derived_facts SET observations = observations + 1, trust = MIN(1.0, trust + ?), source_message_ids = ?, source_memory_ids = ?, updated_at = ? WHERE memory_id = ?`
  ).run(TRUST_REOBSERVED, JSON.stringify(union(haveMsgs, sourceMessageIds)), JSON.stringify(union(haveMems, sourceMemoryIds)), now, id);
  return true;
}

/**
 * Stores a fact through the existing rememberMemory pipeline (redaction,
 * fingerprint + semantic dedupe, triple-level contradiction resolution) and
 * attaches provenance. A dedupe hit becomes a reinforcement.
 */
export async function addDerivedFact(db: Database, fact: NewFact): Promise<FactWriteResult> {
  const category = fact.category ?? "profile";
  const kind = fact.kind ?? "explicit";
  const content = fact.content.trim();
  if (!content) throw new Error("fact content is empty");

  const id = await rememberMemory(db, {
    content,
    scope: "global",
    category: MEMORY_CATEGORY[category],
    peer: fact.peer,
    source_session: fact.session ?? null,
    confidence: clamp01(fact.confidence ?? 0.8),
    tags: ["derived", kind, category],
    entities: fact.entities && fact.entities.length ? fact.entities : [],
    skip_note_log: true,
    actor: fact.actor ?? "deriver",
    // Derived facts describe a person; never auto-flag them as agent guardrails.
    is_negative_constraint: false,
    memory_type: "declarative",
    // Never dedupe into, or supersede, another peer's (or the shared pool's) memories.
    strict_peer: true,
    single_valued_predicates: SINGLE_VALUED_PREDICATES,
    valid_until: fact.valid_until ?? null,
  });

  const existing = db.query(`SELECT memory_id, peer FROM derived_facts WHERE memory_id = ?`).get(id) as { memory_id: string; peer: string } | null;
  if (existing && existing.peer !== fact.peer) {
    // Defense in depth: strict_peer should make this unreachable.
    throw new Error(`dedupe crossed peers (${fact.peer} -> ${existing.peer})`);
  }
  if (existing) {
    if (fact.reinforce !== false) reinforceFact(db, id, fact.source_message_ids ?? [], fact.source_memory_ids ?? []);
    return { id, action: "reinforced" };
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO derived_facts (memory_id, peer, kind, category, trust, observations, source_message_ids, source_memory_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(
    id,
    fact.peer,
    kind,
    category,
    clamp01(fact.trust ?? TRUST_DEFAULT),
    JSON.stringify(fact.source_message_ids ?? []),
    JSON.stringify(fact.source_memory_ids ?? []),
    now,
    now
  );
  return { id, action: "added" };
}

/** Retires temporary derived facts whose valid_until has passed (history is kept). */
export function expireFacts(db: Database, now = Date.now()): number {
  const rows = db
    .query(
      `SELECT m.id FROM memories m JOIN derived_facts d ON d.memory_id = m.id
       WHERE m.is_active = 1 AND m.valid_until IS NOT NULL AND m.valid_until > 0 AND m.valid_until <= ?`
    )
    .all(now) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare(`UPDATE memories SET is_active = 0, status = 'expired', updated_at = ? WHERE id = ? AND is_active = 1`).run(now, r.id);
    db.prepare(`UPDATE entity_triples SET is_active = 0, valid_until = ? WHERE memory_id = ? AND is_active = 1`).run(now, r.id);
    recordMemoryEvent(db, r.id, "MUTATED", "Expired: temporary fact reached its valid_until", "deriver");
  }
  return rows.length;
}

/** Marks `oldId` superseded by `newId` (history is kept; nothing is deleted). */
export function supersedeFact(db: Database, oldId: string, newId: string | null, reason: string, actor = "deriver"): boolean {
  if (oldId === newId) return false;
  const now = Date.now();
  const res = db
    .prepare(`UPDATE memories SET is_active = 0, status = 'superseded', superseded_by_id = ?, updated_at = ? WHERE id = ? AND is_active = 1`)
    .run(newId, now, oldId);
  if (res.changes === 0) return false;
  db.prepare(`UPDATE entity_triples SET is_active = 0, valid_until = ? WHERE memory_id = ?`).run(now, oldId);
  recordMemoryEvent(db, oldId, "SUPERSEDED", reason, actor);
  return true;
}

export function adjustTrust(db: Database, id: string, delta: number): number | null {
  const res = db.prepare(`UPDATE derived_facts SET trust = MIN(1.0, MAX(0.0, trust + ?)), updated_at = ? WHERE memory_id = ?`).run(delta, Date.now(), id);
  if (res.changes === 0) return null;
  return (db.query(`SELECT trust FROM derived_facts WHERE memory_id = ?`).get(id) as { trust: number }).trust;
}

/** Holographic-style trust feedback; also feeds the existing usage counters (feedback.ts). */
export function factFeedback(db: Database, id: string, verdict: "helpful" | "unhelpful", note?: string): { trust: number } | null {
  const trust = adjustTrust(db, id, verdict === "helpful" ? TRUST_HELPFUL : TRUST_UNHELPFUL);
  if (trust === null) return null;
  rateMemory(db, id, verdict === "helpful" ? "helped" : "misled", note ?? undefined, null);
  return { trust };
}

export function listFacts(
  db: Database,
  peer: string,
  opts: { q?: string; category?: string; kind?: string; limit?: number; include_inactive?: boolean } = {}
): FactRow[] {
  const where = ["d.peer = ?"];
  const params: any[] = [peer];
  if (!opts.include_inactive) {
    where.push("m.is_active = 1 AND (m.valid_until IS NULL OR m.valid_until <= 0 OR m.valid_until > ?)");
    params.push(Date.now());
  }
  if (opts.category && (DERIVED_CATEGORIES as readonly string[]).includes(opts.category)) {
    where.push("d.category = ?");
    params.push(opts.category);
  }
  if (opts.kind && (FACT_KINDS as readonly string[]).includes(opts.kind)) {
    where.push("d.kind = ?");
    params.push(opts.kind);
  }
  if (opts.q && opts.q.trim()) {
    where.push("m.content LIKE ? ESCAPE '\\'");
    params.push(`%${opts.q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  }
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  params.push(limit);
  return (db.query(`${FACT_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.is_active DESC, d.updated_at DESC LIMIT ?`).all(...params) as any[]).map(
    toFact
  );
}

export interface FactDetail extends FactRow {
  source_messages: MessageRow[];
  history: Array<{ id: string; content: string; status: string; updated_at: number }>;
}

export function getFactDetail(db: Database, id: string): FactDetail | null {
  const fact = getFactRow(db, id);
  if (!fact) return null;
  const history = db
    .query(`SELECT id, content, status, updated_at FROM memories WHERE superseded_by_id = ? ORDER BY updated_at DESC LIMIT 20`)
    .all(id) as FactDetail["history"];
  return { ...fact, source_messages: getMessagesByIds(db, fact.source_message_ids), history };
}

/** User correction: a new fact supersedes the old one, carrying provenance; trust starts high. */
export async function correctFact(db: Database, id: string, content: string, category?: DerivedCategory): Promise<FactRow | null> {
  const old = getFactRow(db, id);
  if (!old || !old.is_active) return null;
  const trimmed = content.trim();
  if (!trimmed) throw new Error("content is empty");
  if (trimmed === old.content && (!category || category === old.category)) return old;
  if (trimmed === old.content && category) {
    db.prepare(`UPDATE derived_facts SET category = ?, updated_at = ? WHERE memory_id = ?`).run(category, Date.now(), id);
    return getFactRow(db, id);
  }
  // Deactivate first so the correction is not deduped back into the old row.
  supersedeFact(db, id, null, "Corrected by user", "user");
  const res = await addDerivedFact(db, {
    peer: old.peer,
    content: trimmed,
    kind: "manual",
    category: category ?? old.category,
    confidence: 1,
    trust: Math.max(old.trust, 0.8),
    source_message_ids: old.source_message_ids,
    source_memory_ids: union(old.source_memory_ids, [id]),
    session: old.source_session,
    actor: "user",
  });
  db.prepare(`UPDATE memories SET superseded_by_id = ? WHERE id = ?`).run(res.id, id);
  return getFactRow(db, res.id);
}

export async function concludeFact(db: Database, peer: string, content: string, category?: DerivedCategory): Promise<FactWriteResult> {
  return addDerivedFact(db, {
    peer,
    content,
    kind: "conclusion",
    category: category ?? normalizeCategory(content),
    confidence: 1,
    trust: 0.7,
    actor: "user",
  });
}

/** Hard delete through the existing cryptographic purge (receipt returned). */
export function purgeFact(db: Database, id: string): PurgeReceipt | null {
  if (!db.query(`SELECT 1 FROM memories WHERE id = ?`).get(id)) return null;
  const receipt = cryptographicPurge(db, id);
  db.prepare(`DELETE FROM derived_facts WHERE memory_id = ?`).run(id);
  return receipt;
}

const CATEGORY_RANK: Record<DerivedCategory, number> = { profile: 0, preferences: 1, patterns: 2, entities: 3, cases: 4, events: 5 };

/**
 * Facts eligible for the peer card: trusted, confident, active. A reflect insight is a
 * model's synthesis, not something the person said: it needs trust >= the insight
 * threshold (MNEMO_INSIGHT_CARD_TRUST, default 0.6) or a re-observation to get in.
 */
export function cardFacts(db: Database, peer: string, limit = 12): FactRow[] {
  const rows = (db
    .query(
      `${FACT_SELECT} WHERE d.peer = ? AND m.is_active = 1 AND d.trust >= ? AND m.confidence >= ?
       AND (m.valid_until IS NULL OR m.valid_until <= 0 OR m.valid_until > ?)
       AND (d.kind != 'insight' OR d.trust >= ? OR d.observations >= 2)`
    )
    .all(peer, CARD_MIN_TRUST, CARD_MIN_CONFIDENCE, Date.now(), insightCardMinTrust()) as any[]).map(toFact);
  rows.sort(
    (a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || b.trust * b.confidence - a.trust * a.confidence || b.updated_at - a.updated_at
  );
  return rows.slice(0, limit);
}

/* ---------------------------- tiered loading ---------------------------- */

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

/** Truncates to roughly `tokens` tokens at a word boundary. */
export function truncateTokens(s: string, tokens: number): string {
  const max = tokens * 4;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + "…";
}

export type Tier = "L0" | "L1" | "L2";

export interface TieredItem {
  id: string;
  tier: Tier;
  category: DerivedCategory;
  kind: FactKind;
  trust: number;
  text: string;
  score?: number;
  /** Source messages, trimmed to what an agent needs (no queue internals: digests, claim state, errors). */
  provenance?: Array<Pick<MessageRow, "id" | "session" | "role" | "content" | "ts">>;
}

/**
 * L0: ~100-token abstract per fact. L1: full fact text grouped into a ~2k-token
 * overview. L2: full record plus its source messages (on request only).
 */
export function renderTier(db: Database, facts: Array<FactRow & { score?: number }>, tier: Tier, budgetTokens?: number): { items: TieredItem[]; text: string } {
  const items: TieredItem[] = [];
  const budget = budgetTokens ?? (tier === "L0" ? 100 * Math.max(1, facts.length) : tier === "L1" ? 2000 : 100000);
  let used = 0;
  for (const f of facts) {
    const text = tier === "L0" ? truncateTokens(f.content, 100) : f.content;
    const cost = estimateTokens(text) + 8;
    if (items.length > 0 && used + cost > budget) break;
    used += cost;
    items.push({
      id: f.id,
      tier,
      category: f.category,
      kind: f.kind,
      trust: Number(f.trust.toFixed(2)),
      text,
      score: f.score,
      provenance: tier === "L2" ? getMessagesByIds(db, f.source_message_ids).map((m) => ({ id: m.id, session: m.session, role: m.role, content: m.content, ts: m.ts })) : undefined,
    });
  }
  let text: string;
  if (tier === "L1") {
    const groups = new Map<string, TieredItem[]>();
    for (const it of items) groups.set(it.category, [...(groups.get(it.category) ?? []), it]);
    text = [...groups.entries()].map(([cat, its]) => `## ${cat}\n${its.map((i) => `- [${i.id}] ${i.text}`).join("\n")}`).join("\n\n");
  } else {
    text = items.map((i) => `- [${i.id}] ${i.text}`).join("\n");
  }
  return { items, text };
}
