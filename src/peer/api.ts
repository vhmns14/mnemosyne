import type { Database } from "bun:sqlite";
import { DeriverWorker } from "../engine/deriver.ts";
import {
  concludeFact,
  correctFact,
  DERIVED_CATEGORIES,
  factFeedback,
  getFactDetail,
  getFactRow,
  listFacts,
  normalizeCategory,
  purgeFact,
  renderTier,
  type Tier,
} from "../engine/facts.ts";
import { askPeer, reflectPeer } from "../engine/insights.ts";
import { LlmClient } from "../engine/llm.ts";
import { checkpointTranscript, ingestMessages, PEER_RE, requeueDeadLetters, type MessageInput } from "../engine/messages.ts";

/** Hand-written facts/conclusions are short statements, not documents. */
const MAX_FACT_CHARS = 2000;
import { buildContext, getRepresentation, listPeers, peerRecall, refreshRepresentation, setPinnedCard } from "../engine/representation.ts";

/**
 * REST routes for the personal-memory layer. Mounted by src/server.ts (and by
 * tests directly). Returns null when the route is not ours.
 */
export interface PeerApiContext {
  db: Database;
  worker: DeriverWorker;
  llm?: () => LlmClient | null;
}

type Json = Record<string, any>;

async function body(req: Request): Promise<Json> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Json) : {};
  } catch {
    return {};
  }
}

const TIERS: Tier[] = ["L0", "L1", "L2"];

export async function handlePeerApi(req: Request, url: URL, ctx: PeerApiContext, headers: Record<string, string> = {}): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method;
  const llm = () => (ctx.llm ? ctx.llm() : LlmClient.fromEnv());
  const ok = (data: Json, status = 200) => Response.json({ success: status < 400, ...data }, { status, headers });
  const bad = (error: string, status = 400) => Response.json({ success: false, error }, { status, headers });

  if (path === "/v1/messages" && method === "POST") {
    const b = await body(req);
    const list: MessageInput[] = Array.isArray(b.messages) ? b.messages : [b as MessageInput];
    if (list.length === 0 || list.length > 500) return bad("send 1-500 messages");
    for (const m of list) {
      if (!m || typeof m.content !== "string" || typeof m.peer !== "string") return bad("each message needs string 'peer' and 'content'");
    }
    try {
      const res = ingestMessages(ctx.db, list);
      if (res.ingested > 0) ctx.worker.kick();
      return ok(res);
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  if (path === "/v1/deriver/status" && method === "GET") {
    return ok({ status: ctx.worker.status() });
  }
  if (path === "/v1/deriver/requeue" && method === "POST") {
    const b = await body(req);
    const peer = typeof b.peer === "string" && PEER_RE.test(b.peer) ? b.peer : undefined;
    const requeued = requeueDeadLetters(ctx.db, peer);
    if (requeued > 0) ctx.worker.kick();
    return ok({ requeued });
  }
  if (path === "/v1/deriver/run" && method === "POST") {
    const r = await ctx.worker.tick();
    return ok({ result: r, status: ctx.worker.status() });
  }
  if (path === "/v1/peers" && method === "GET") {
    return ok({ peers: listPeers(ctx.db) });
  }

  const m = path.match(/^\/v1\/peers\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  let peer: string;
  try {
    peer = decodeURIComponent(m[1]);
  } catch {
    return bad("invalid peer");
  }
  if (!PEER_RE.test(peer)) return bad("invalid peer: use 1-64 chars of [A-Za-z0-9_.:@-]");
  const rest = m[2] || "";

  if (rest === "/representation" && method === "GET") {
    const rep = url.searchParams.get("refresh") === "1" ? await refreshRepresentation(ctx.db, peer, llm()) : getRepresentation(ctx.db, peer);
    return ok({ representation: rep });
  }

  if (rest === "/card" && (method === "POST" || method === "PUT")) {
    const b = await body(req);
    if (b.card !== null && !Array.isArray(b.card)) return bad("'card' must be an array of strings or null");
    if (Array.isArray(b.card) && b.card.some((c: unknown) => typeof c !== "string")) return bad("'card' must be an array of strings or null");
    return ok({ representation: setPinnedCard(ctx.db, peer, b.card === null ? null : b.card.map(String)) });
  }

  if (rest === "/ask" && method === "POST") {
    const b = await body(req);
    if (typeof b.question !== "string" || !b.question.trim()) return bad("'question' is required");
    if (b.question.length > 4000) return bad("'question' is limited to 4000 characters", 413);
    try {
      return ok(await askPeer(ctx.db, llm(), peer, b.question, { depth: Number(b.depth) || 1 }));
    } catch (err) {
      return bad(`dialectic failed: ${(err as Error).message}`, 502);
    }
  }

  if (rest === "/context" && method === "POST") {
    const b = await body(req);
    const tier = TIERS.includes(b.tier) ? (b.tier as Tier) : "L0";
    const res = await buildContext(ctx.db, peer, {
      query: typeof b.query === "string" ? b.query : undefined,
      session: typeof b.session === "string" ? b.session : undefined,
      tokens: Number(b.tokens) || undefined,
      tier,
    });
    return ok(res);
  }

  if (rest === "/search" && method === "GET") {
    const q = url.searchParams.get("q") || "";
    const tierParam = url.searchParams.get("tier") as Tier;
    const tier = TIERS.includes(tierParam) ? tierParam : "L0";
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 8));
    const hits = await peerRecall(ctx.db, peer, q, limit);
    return ok({ tier, ...renderTier(ctx.db, hits, tier) });
  }

  if (rest === "/facts" && method === "GET") {
    const facts = listFacts(ctx.db, peer, {
      q: url.searchParams.get("q") || undefined,
      category: url.searchParams.get("category") || undefined,
      kind: url.searchParams.get("kind") || undefined,
      limit: Number(url.searchParams.get("limit")) || 100,
      include_inactive: url.searchParams.get("include_inactive") === "1",
    });
    return ok({ facts, categories: DERIVED_CATEGORIES });
  }

  if (rest === "/conclusions" && method === "POST") {
    const b = await body(req);
    if (typeof b.content !== "string" || !b.content.trim()) return bad("'content' is required");
    if (b.content.length > MAX_FACT_CHARS) return bad(`'content' is limited to ${MAX_FACT_CHARS} characters`, 413);
    const res = await concludeFact(ctx.db, peer, b.content, b.category ? normalizeCategory(b.category) : undefined);
    return ok({ ...res, fact: getFactRow(ctx.db, res.id) });
  }

  if (rest === "/checkpoint" && method === "POST") {
    const b = await body(req);
    if (!Array.isArray(b.messages)) return bad("'messages' must be an array");
    const session = typeof b.session === "string" && b.session.trim() ? b.session.trim() : "default";
    try {
      const res = checkpointTranscript(ctx.db, peer, session, b.messages);
      if (res.queued > 0) ctx.worker.kick();
      return ok(res);
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  if (rest === "/reflect" && method === "POST") {
    try {
      return ok(await reflectPeer(ctx.db, peer, llm()));
    } catch (err) {
      return bad(`reflect failed: ${(err as Error).message}`, 502);
    }
  }

  const fm = rest.match(/^\/facts\/([0-9a-fA-F-]{36})(\/feedback)?$/);
  if (fm) {
    const id = fm[1];
    const fact = getFactRow(ctx.db, id);
    if (!fact || fact.peer !== peer) return bad("fact not found", 404);
    if (fm[2]) {
      if (method !== "POST") return bad("method not allowed", 405);
      const b = await body(req);
      if (b.verdict !== "helpful" && b.verdict !== "unhelpful") return bad("'verdict' must be helpful or unhelpful");
      return ok({ id, ...factFeedback(ctx.db, id, b.verdict, typeof b.note === "string" ? b.note : undefined) });
    }
    if (method === "GET") return ok({ fact: getFactDetail(ctx.db, id) });
    if (method === "PATCH") {
      const b = await body(req);
      if (typeof b.content !== "string" || !b.content.trim()) return bad("'content' is required");
      if (b.content.length > MAX_FACT_CHARS) return bad(`'content' is limited to ${MAX_FACT_CHARS} characters`, 413);
      const updated = await correctFact(ctx.db, id, b.content, b.category ? normalizeCategory(b.category) : undefined);
      if (!updated) return bad("fact is not active", 409);
      return ok({ fact: updated, replaced: updated.id !== id ? id : null });
    }
    if (method === "DELETE") {
      const receipt = purgeFact(ctx.db, id);
      return ok({ id, receipt });
    }
    return bad("method not allowed", 405);
  }

  return null;
}
