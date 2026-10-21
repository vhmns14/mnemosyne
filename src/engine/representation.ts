import type { Database } from "bun:sqlite";
import { searchHybrid } from "./hybrid.ts";
import { cardFacts, getFactRow, listFacts, renderTier, truncateTokens, estimateTokens, type FactRow, type Tier, type TieredItem } from "./facts.ts";
import { fenceContext } from "./messages.ts";
import type { LlmClient } from "./llm.ts";

/**
 * Peer representation (Honcho-style): a short living summary + a peer card of
 * stable, trusted facts, refreshed by the deriver. Also: per-session summaries,
 * peer-scoped hybrid recall with trust-aware ranking, and the two-layer context
 * block injected into an agent's prompt.
 */

export interface Representation {
  peer: string;
  summary: string;
  card: string[];
  card_fact_ids: string[];
  pinned: boolean;
  fact_count: number;
  source: "llm" | "deterministic" | "empty";
  updated_at: number | null;
}

/** Peer-scoped hybrid recall (existing searchHybrid) re-ranked by trust. */
export async function peerRecall(db: Database, peer: string, query: string, limit = 8): Promise<Array<FactRow & { score: number }>> {
  if (!query.trim()) return [];
  const hits = await searchHybrid(db, { query, limit: Math.max(40, limit * 5), min_relevance: 0.05, scope: "all" });
  const out: Array<FactRow & { score: number }> = [];
  for (const h of hits) {
    if (h.peer !== peer) continue;
    const fact = getFactRow(db, h.id);
    if (!fact || !fact.is_active) continue;
    // Trust 0.5 is neutral (x1.0); 1.0 -> x1.4; 0.0 -> x0.6.
    out.push({ ...fact, score: Number((h.score * (0.6 + 0.8 * fact.trust)).toFixed(4)) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export function getRepresentation(db: Database, peer: string): Representation {
  const row = db.query(`SELECT * FROM peer_representations WHERE peer = ?`).get(peer) as any;
  const facts = cardFacts(db, peer);
  let pinned: string[] | null = null;
  try {
    pinned = row?.pinned_card ? JSON.parse(row.pinned_card) : null;
  } catch {
    pinned = null;
  }
  const count = (db.query(`SELECT COUNT(*) AS c FROM derived_facts d JOIN memories m ON m.id = d.memory_id WHERE d.peer = ? AND m.is_active = 1`).get(peer) as { c: number }).c;
  return {
    peer,
    summary: row?.summary ?? "",
    card: pinned ?? facts.map((f) => f.content),
    card_fact_ids: pinned ? [] : facts.map((f) => f.id),
    pinned: Boolean(pinned),
    fact_count: count,
    source: row ? row.source : "empty",
    updated_at: row?.updated_at ?? null,
  };
}

/** Manual peer card (Honcho "card overwrite"); pass null to return to the derived card. */
export function setPinnedCard(db: Database, peer: string, card: string[] | null): Representation {
  const now = Date.now();
  db.prepare(
    `INSERT INTO peer_representations (peer, summary, card, pinned_card, fact_count, source, updated_at)
     VALUES (?, '', '[]', ?, 0, 'deterministic', ?)
     ON CONFLICT(peer) DO UPDATE SET pinned_card = excluded.pinned_card, updated_at = excluded.updated_at`
  ).run(peer, card ? JSON.stringify(card.map((c) => String(c).slice(0, 500)).slice(0, 40)) : null, now);
  return getRepresentation(db, peer);
}

function deterministicSummary(facts: FactRow[]): string {
  if (facts.length === 0) return "";
  return facts
    .slice(0, 6)
    .map((f) => f.content.replace(/\s+/g, " ").replace(/[.\s]+$/, ""))
    .join(". ") + ".";
}

/** Regenerates the living summary from current facts (LLM when available). */
export async function refreshRepresentation(db: Database, peer: string, llm: LlmClient | null): Promise<Representation> {
  const facts = listFacts(db, peer, { limit: 60 }).sort((a, b) => b.trust * b.confidence - a.trust * a.confidence);
  let summary = deterministicSummary(facts);
  let source: "llm" | "deterministic" = "deterministic";
  if (llm && facts.length > 0) {
    try {
      const reply = await llm.chatJSON<{ summary?: string }>([
        {
          role: "system",
          content:
            'You maintain a short, living profile of a person from facts an assistant learned about them. Write 3-5 plain sentences: who they are, what they are working on, key preferences and constraints. Use only the facts given; no speculation. Reply as JSON: {"summary": "..."}',
        },
        { role: "user", content: facts.map((f) => `- (${f.category}, trust ${f.trust.toFixed(2)}) ${f.content}`).join("\n") },
      ]);
      if (typeof reply.summary === "string" && reply.summary.trim()) {
        summary = reply.summary.trim().slice(0, 2000);
        source = "llm";
      }
    } catch {
      // keep deterministic summary; the deriver records LLM errors separately
    }
  }
  const card = cardFacts(db, peer).map((f) => f.content);
  db.prepare(
    `INSERT INTO peer_representations (peer, summary, card, fact_count, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(peer) DO UPDATE SET summary = excluded.summary, card = excluded.card, fact_count = excluded.fact_count,
       source = excluded.source, updated_at = excluded.updated_at`
  ).run(peer, summary, JSON.stringify(card), facts.length, source, Date.now());
  return getRepresentation(db, peer);
}

export function upsertSessionSummary(db: Database, peer: string, session: string, summary: string, addedMessages: number): void {
  db.prepare(
    `INSERT INTO session_summaries (peer, session, summary, message_count, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(peer, session) DO UPDATE SET summary = excluded.summary,
       message_count = session_summaries.message_count + excluded.message_count, updated_at = excluded.updated_at`
  ).run(peer, session, summary.slice(0, 4000), addedMessages, Date.now());
}

export function getSessionSummary(db: Database, peer: string, session: string): { summary: string; message_count: number; updated_at: number } | null {
  return db.query(`SELECT summary, message_count, updated_at FROM session_summaries WHERE peer = ? AND session = ?`).get(peer, session) as any;
}

export function listPeers(db: Database): Array<{ peer: string; facts: number; messages: number }> {
  return db
    .query(
      `SELECT peer, SUM(facts) AS facts, SUM(messages) AS messages FROM (
         SELECT d.peer AS peer, COUNT(*) AS facts, 0 AS messages FROM derived_facts d JOIN memories m ON m.id = d.memory_id WHERE m.is_active = 1 GROUP BY d.peer
         UNION ALL
         SELECT peer, 0, COUNT(*) FROM messages GROUP BY peer
       ) GROUP BY peer ORDER BY peer`
    )
    .all() as any;
}

export interface ContextOptions {
  query?: string;
  session?: string;
  /** Total token budget for the block (default 1200). */
  tokens?: number;
  tier?: Tier;
  limit?: number;
}

export interface ContextResult {
  peer: string;
  base: { summary: string; card: string[]; session_summary: string | null };
  recall: TieredItem[];
  text: string;
  tokens: number;
}

/**
 * Base layer (representation + peer card + session summary) plus query recall
 * at the requested tier, packed into a token budget and fenced so the client
 * can strip it from captured turns.
 */
export async function buildContext(db: Database, peer: string, opts: ContextOptions = {}): Promise<ContextResult> {
  const budget = Math.max(200, Math.min(8000, opts.tokens ?? 1200));
  const rep = getRepresentation(db, peer);
  const sess = opts.session ? getSessionSummary(db, peer, opts.session) : null;
  const parts: string[] = [];
  if (rep.summary) parts.push(`## About ${peer}\n${truncateTokens(rep.summary, Math.floor(budget * 0.3))}`);
  if (rep.card.length) parts.push(`## Peer card\n${rep.card.slice(0, 12).map((c) => `- ${c}`).join("\n")}`);
  if (sess?.summary) parts.push(`## This session so far\n${truncateTokens(sess.summary, Math.floor(budget * 0.2))}`);
  let used = estimateTokens(parts.join("\n\n"));
  let recall: TieredItem[] = [];
  if (opts.query && opts.query.trim()) {
    const cardIds = new Set(rep.card_fact_ids);
    const hits = (await peerRecall(db, peer, opts.query, opts.limit ?? 8)).filter((h) => !cardIds.has(h.id));
    const remaining = Math.max(0, budget - used);
    if (hits.length && remaining > 40) {
      const rendered = renderTier(db, hits, opts.tier ?? "L0", remaining);
      recall = rendered.items;
      if (rendered.text) parts.push(`## Relevant memories\n${rendered.text}`);
    }
  }
  const body = parts.join("\n\n");
  used = estimateTokens(body);
  return {
    peer,
    base: { summary: rep.summary, card: rep.card, session_summary: sess?.summary ?? null },
    recall,
    text: body ? fenceContext(body) : "",
    tokens: used,
  };
}
