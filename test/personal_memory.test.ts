import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { CONFIG } from "../src/config.ts";
import { LlmClient, resolveChatUrl, parseJsonReply, displayUrl } from "../src/engine/llm.ts";
import { ingestMessages, checkpointTranscript, stripFences, fenceContext, isTrivialMessage, queueStats } from "../src/engine/messages.ts";
import { runDeriverOnce, deriverStatus } from "../src/engine/deriver.ts";
import { addDerivedFact, listFacts, getFactRow, getFactDetail, factFeedback, cardFacts, renderTier } from "../src/engine/facts.ts";
import { getRepresentation, buildContext, peerRecall } from "../src/engine/representation.ts";
import { askPeer, reflectPeer } from "../src/engine/insights.ts";
import { getEmbedding, EMBEDDING_DIM } from "../src/engine/embedder.ts";
import { MockOpenAI, parseTranscript, idsIn } from "./helpers/mock_openai.ts";

let mock: MockOpenAI;
let db: Database;
let llm: LlmClient;

function freshDb(): Database {
  const d = new Database(":memory:");
  initSchema(d);
  return d;
}

/** Extraction handler: one fact per user line, using the given mapping text -> fact. */
function extractFrom(map: (text: string) => { content: string; category?: string; kind?: string } | null) {
  return (call: { user: string }) => {
    const facts = parseTranscript(call.user)
      .map((m) => {
        const f = map(m.text);
        return f ? { kind: "explicit", category: "profile", confidence: 0.9, ...f, source_message_ids: [m.id] } : null;
      })
      .filter(Boolean);
    return { facts, session_summaries: { s1: "Alice talked about her tools and city." } };
  };
}

beforeAll(() => {
  mock = new MockOpenAI();
});
afterAll(() => mock.stop());
beforeEach(() => {
  mock.reset();
  db = freshDb();
  llm = new LlmClient({ url: mock.baseUrl, apiKey: "test-key-123", model: "mock-model", backoffMs: 1, maxRetries: 2 });
});

describe("LLM client (OpenAI-compatible)", () => {
  test("resolves base URLs and parses fenced JSON", () => {
    expect(resolveChatUrl("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(resolveChatUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1/chat/completions");
    expect(resolveChatUrl("http://x/v1/chat/completions")).toBe("http://x/v1/chat/completions");
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(displayUrl("https://user:pw@host.example/v1/chat/completions?key=abc")).toBe("https://host.example/v1/chat/completions");
  });

  test("retries 5xx with backoff, then succeeds; sends JSON mode + bearer", async () => {
    mock.failNext = 2;
    mock.handlers.summary = () => ({ summary: "ok" });
    const out = await llm.chatJSON([{ role: "system", content: "living profile" }, { role: "user", content: "x" }]);
    expect(out.summary).toBe("ok");
    expect(mock.calls[0].body.response_format).toEqual({ type: "json_object" });
    expect(mock.calls[0].auth).toBe("Bearer test-key-123");
  });

  test("falls back to plain mode when the server rejects response_format", async () => {
    mock.rejectJsonMode = true;
    mock.handlers.summary = () => ({ summary: "plain" });
    const out = await llm.chatJSON([{ role: "system", content: "living profile" }, { role: "user", content: "x" }]);
    expect(out.summary).toBe("plain");
    expect(mock.calls[0].body.response_format).toBeUndefined();
  });
});

describe("Ingest", () => {
  test("appends + enqueues without any LLM call; idempotent on retry; trivial turns skipped", () => {
    const msgs = [
      { peer: "alice", session: "s1", role: "user", content: "I prefer TypeScript over Python for side projects", ts: 1000 },
      { peer: "alice", session: "s1", role: "user", content: "ok", ts: 1001 },
    ];
    const first = ingestMessages(db, msgs);
    expect(first.ingested).toBe(2);
    const retry = ingestMessages(db, msgs);
    expect(retry.ingested).toBe(0);
    expect(retry.duplicates).toBe(2);
    const stats = queueStats(db);
    expect(stats.pending).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(mock.calls.length).toBe(0);
    expect(() => ingestMessages(db, [{ peer: "bad peer!", content: "x" }])).toThrow();
  });

  test("context fences are stripped before storage so recalled memory is never re-learned", () => {
    expect(isTrivialMessage("thanks!")).toBe(true);
    expect(isTrivialMessage("I moved to Bandung")).toBe(false);
    const injected = fenceContext("- alice likes coffee");
    ingestMessages(db, [{ peer: "alice", content: `${injected}\nWhat should I drink today?` }]);
    const row = db.query("SELECT content FROM messages").get() as { content: string };
    expect(row.content).toBe("What should I drink today?");
    expect(stripFences("<memory-context>x</memory-context> hi there")).toBe("hi there");
  });

  test("checkpoint is idempotent by transcript digest and skips already-archived messages", () => {
    const t1 = [
      { role: "user", content: "I am training for a marathon in March" },
      { role: "assistant", content: "Great, let's plan." },
      { role: "tool", content: "ignored" },
    ];
    const a = checkpointTranscript(db, "alice", "s1", t1);
    expect(a.duplicate).toBe(false);
    expect(a.queued).toBe(2);
    const b = checkpointTranscript(db, "alice", "s1", t1);
    expect(b.duplicate).toBe(true);
    expect(b.queued).toBe(0);
    const c = checkpointTranscript(db, "alice", "s1", [...t1, { role: "user", content: "My knee hurts after long runs" }]);
    expect(c.duplicate).toBe(false);
    expect(c.queued).toBe(1);
  });
});

describe("Deriver", () => {
  test("ingest → derive → facts with provenance, session summary, representation; secrets never sent", async () => {
    mock.handlers.extract = extractFrom((t) => {
      if (t.includes("TypeScript")) return { content: "alice prefers TypeScript over Python", category: "preferences" };
      if (t.includes("Purwokerto")) return { content: "alice lives in Purwokerto", category: "profile" };
      return null;
    });
    mock.handlers.summary = () => ({ summary: "Alice is a TypeScript developer based in Purwokerto." });
    const ing = ingestMessages(db, [
      { peer: "alice", session: "s1", role: "user", content: "I prefer TypeScript over Python for side projects" },
      { peer: "alice", session: "s1", role: "user", content: "thanks" },
      { peer: "alice", session: "s1", role: "user", content: "I live in Purwokerto. my key is sk-proj-ABCDEFGHIJKLMNOPQRSTUV123" },
    ]);
    const res = await runDeriverOnce(db, llm);
    expect(res.error).toBeNull();
    expect(res.batches.length).toBe(1);
    expect(res.batches[0].added).toBe(2);

    const extract = mock.callsOf("extract")[0];
    expect(extract.user).not.toContain("sk-proj-ABCDEFGHIJKLMNOPQRSTUV123");
    expect(extract.user).not.toContain(": thanks"); // trivial turn never reaches the LLM

    const facts = listFacts(db, "alice");
    expect(facts.length).toBe(2);
    const ts = facts.find((f) => f.content.includes("TypeScript"))!;
    expect(ts.category).toBe("preferences");
    expect(ts.trust).toBe(0.5);
    expect(ts.source_message_ids).toEqual([ing.ids[0]]);
    const detail = getFactDetail(db, ts.id)!;
    expect(detail.source_messages[0].content).toContain("TypeScript");

    expect(queueStats(db).pending).toBe(0);
    const rep = getRepresentation(db, "alice");
    expect(rep.summary).toContain("TypeScript developer");
    expect(rep.card.length).toBe(2);
    const sess = db.query("SELECT summary FROM session_summaries WHERE peer='alice' AND session='s1'").get() as any;
    expect(sess.summary).toContain("Alice");
  });

  test("Mem0 decision: DELETE supersedes a contradicted fact, NOOP reinforces trust, UPDATE merges", async () => {
    const coffee = await addDerivedFact(db, { peer: "alice", content: "alice likes drinking coffee every morning", category: "preferences" });
    const editor = await addDerivedFact(db, { peer: "alice", content: "alice uses the neovim editor daily", category: "preferences" });
    const city = await addDerivedFact(db, { peer: "alice", content: "alice works on a mobile banking app", category: "entities" });

    mock.handlers.extract = extractFrom((t) => {
      if (t.includes("coffee")) return { content: "alice stopped drinking coffee every morning", category: "preferences" };
      if (t.includes("neovim")) return { content: "alice uses the neovim editor every day", category: "preferences" };
      if (t.includes("banking")) return { content: "alice works on a mobile banking app written in Flutter", category: "entities" };
      return null;
    });
    mock.handlers.decide = (call) => {
      const decisions: any[] = [];
      const blocks = call.user.split(/\n\n(?=Candidate )/);
      for (const b of blocks) {
        const idx = Number(b.match(/^Candidate (\d+)/)?.[1]);
        const ids = idsIn(b);
        if (b.includes("stopped drinking coffee")) decisions.push({ index: idx, action: "DELETE", target_id: coffee.id });
        else if (b.includes("neovim")) decisions.push({ index: idx, action: "NOOP", target_id: editor.id });
        else if (b.includes("Flutter")) decisions.push({ index: idx, action: "UPDATE", target_id: city.id, content: "alice works on a mobile banking app built with Flutter" });
        else decisions.push({ index: idx, action: "ADD", target_id: ids[0] ?? "" });
      }
      return { decisions };
    };
    ingestMessages(db, [
      { peer: "alice", session: "s1", content: "I quit coffee, no more coffee for me" },
      { peer: "alice", session: "s1", content: "neovim all day, every day" },
      { peer: "alice", session: "s1", content: "the banking app is written in Flutter" },
    ]);
    const res = await runDeriverOnce(db, llm);
    expect(res.error).toBeNull();
    expect(mock.callsOf("decide").length).toBe(1);
    const r = res.batches[0];
    expect(r.deleted).toBe(1);
    expect(r.noop).toBe(1);
    expect(r.updated).toBe(1);

    const oldCoffee = getFactRow(db, coffee.id)!;
    expect(oldCoffee.is_active).toBe(false);
    expect(oldCoffee.status).toBe("superseded");
    const newCoffee = getFactRow(db, oldCoffee.superseded_by_id!)!;
    expect(newCoffee.content).toContain("stopped drinking coffee");
    expect(newCoffee.is_active).toBe(true);

    const ed = getFactRow(db, editor.id)!;
    expect(ed.trust).toBeCloseTo(0.53, 5);
    expect(ed.observations).toBe(2);
    expect(ed.source_message_ids.length).toBe(1);

    const oldCity = getFactRow(db, city.id)!;
    expect(oldCity.is_active).toBe(false);
    expect(getFactRow(db, oldCity.superseded_by_id!)!.content).toContain("built with Flutter");
  });

  test("triple-level contradiction (LIKES vs DISLIKES) supersedes via the existing conflict logic", async () => {
    const first = await addDerivedFact(db, {
      peer: "bob",
      content: "bob likes spicy food",
      entities: [{ subject: "bob", predicate: "LIKES", object: "spicy food" }],
    });
    const second = await addDerivedFact(db, {
      peer: "bob",
      content: "bob dislikes spicy food now",
      entities: [{ subject: "bob", predicate: "DISLIKES", object: "spicy food" }],
    });
    expect(getFactRow(db, first.id)!.is_active).toBe(false);
    expect(getFactRow(db, second.id)!.is_active).toBe(true);
  });

  test("offline: batch goes back on the queue with backoff, then succeeds when the endpoint returns", async () => {
    const dead = new LlmClient({ url: "http://127.0.0.1:9/v1", model: "m", maxRetries: 0, timeoutMs: 500 });
    ingestMessages(db, [{ peer: "alice", content: "I am learning Rust this month" }]);
    const failed = await runDeriverOnce(db, dead);
    expect(failed.failed).toBe(1);
    expect(failed.error).toContain("unreachable");
    let row = db.query("SELECT status, attempts, next_attempt_at, last_error FROM messages").get() as any;
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at).toBeGreaterThan(Date.now());
    const st = deriverStatus(db, dead);
    expect(st.last_error).toContain("unreachable");
    expect(st.queue.pending).toBe(1);
    expect(st.queue.due_now).toBe(0);

    // Not due yet: nothing is claimed even with a working endpoint.
    const early = await runDeriverOnce(db, llm);
    expect(early.batches.length).toBe(0);

    db.exec("UPDATE messages SET next_attempt_at = 0");
    mock.handlers.extract = extractFrom(() => ({ content: "alice is learning Rust", category: "profile" }));
    const ok = await runDeriverOnce(db, llm);
    expect(ok.error).toBeNull();
    row = db.query("SELECT status FROM messages").get() as any;
    expect(row.status).toBe("done");
    expect(listFacts(db, "alice").length).toBe(1);
    expect(deriverStatus(db, llm).last_error).toBeNull();
  });

  test("without an LLM the queue just waits", async () => {
    ingestMessages(db, [{ peer: "alice", content: "I like hiking on weekends" }]);
    const res = await runDeriverOnce(db, null);
    expect(res.skipped_reason).toContain("LLM not configured");
    expect(queueStats(db).pending).toBe(1);
  });
});

describe("Dialectic ask", () => {
  test("answers with validated citations; depth 3 runs answer, audit, reconcile", async () => {
    const f = await addDerivedFact(db, { peer: "alice", content: "alice prefers TypeScript over Python", category: "preferences" });
    mock.handlers.ask = (call) => ({ answer: "She prefers TypeScript.", citations: [idsIn(call.user)[0], "00000000-0000-0000-0000-000000000000"], abstain: false });
    mock.handlers.audit = (call) => ({ answer: "Alice prefers TypeScript over Python.", citations: [idsIn(call.user)[0]], abstain: false });
    mock.handlers.reconcile = (call) => ({ answer: "Alice prefers TypeScript over Python.", citations: [idsIn(call.user)[0]], abstain: false });
    const res = await askPeer(db, llm, "alice", "Which programming language does alice prefer, TypeScript or Python?", { depth: 3 });
    expect(res.abstained).toBe(false);
    expect(res.citations.map((c) => c.id)).toEqual([f.id]);
    expect(res.answer).toContain("TypeScript");
    expect(mock.callsOf("ask").length).toBe(1);
    expect(mock.callsOf("audit").length).toBe(1);
    expect(mock.callsOf("reconcile").length).toBe(1);
  });

  test("abstains without calling the LLM when memory is empty, and when the model cannot cite", async () => {
    const empty = await askPeer(db, llm, "alice", "What is alice's favourite band?");
    expect(empty.abstained).toBe(true);
    expect(mock.calls.length).toBe(0);

    await addDerivedFact(db, { peer: "alice", content: "alice plays the guitar in a band", category: "profile" });
    mock.handlers.ask = () => ({ answer: "Probably Radiohead.", citations: [], abstain: false });
    const uncited = await askPeer(db, llm, "alice", "What band does alice like? guitar band");
    expect(uncited.abstained).toBe(true);
    expect(uncited.answer).toContain("don't know");
  });
});

describe("Trust, card, tiers, context, reflect, embeddings", () => {
  test("feedback moves trust (+0.05 / -0.10), drops facts off the card, and changes ranking", async () => {
    const a = await addDerivedFact(db, { peer: "alice", content: "alice drinks green tea while coding", category: "preferences" });
    const b = await addDerivedFact(db, { peer: "alice", content: "alice drinks black tea while coding at night", category: "preferences" });
    expect(factFeedback(db, a.id, "helpful")!.trust).toBeCloseTo(0.55, 5);
    expect(factFeedback(db, b.id, "unhelpful")!.trust).toBeCloseTo(0.4, 5);
    const card = cardFacts(db, "alice").map((f) => f.id);
    expect(card).toContain(a.id);
    expect(card).not.toContain(b.id);
    const usage = db.query("SELECT helped, misled FROM memory_usage WHERE memory_id = ?").get(b.id) as any;
    expect(usage.misled).toBe(1);
    const hits = await peerRecall(db, "alice", "alice drinks tea while coding", 5);
    expect(hits[0].id).toBe(a.id);
  });

  test("tiered rendering: L0 abstract, L1 grouped overview, L2 with provenance", async () => {
    const ing = ingestMessages(db, [{ peer: "alice", content: "long story about my thesis" }]);
    const long = "alice is writing a thesis about soil moisture sensors " + "with lots of detail ".repeat(60);
    const f = await addDerivedFact(db, { peer: "alice", content: long, category: "entities", source_message_ids: ing.ids });
    const facts = listFacts(db, "alice");
    const l0 = renderTier(db, facts, "L0");
    expect(l0.items[0].text.length).toBeLessThanOrEqual(402);
    const l1 = renderTier(db, facts, "L1");
    expect(l1.text).toContain("## entities");
    expect(l1.items[0].text).toBe(long.trim());
    const l2 = renderTier(db, facts, "L2");
    expect(l2.items[0].provenance![0].content).toContain("thesis");
    expect(f.action).toBe("added");
  });

  test("two-layer base context is fenced and within budget", async () => {
    await addDerivedFact(db, { peer: "alice", content: "alice prefers concise answers in Indonesian", category: "preferences" });
    await addDerivedFact(db, { peer: "alice", content: "alice is building a Bun SQLite memory engine", category: "entities", trust: 0.4 });
    const ctx = await buildContext(db, "alice", { query: "memory engine", tokens: 300 });
    expect(ctx.text.startsWith("<mnemo-memory>")).toBe(true);
    expect(ctx.text.endsWith("</mnemo-memory>")).toBe(true);
    expect(ctx.base.card).toContain("alice prefers concise answers in Indonesian");
    expect(ctx.recall.some((r) => r.text.includes("memory engine"))).toBe(true);
    expect(ctx.tokens).toBeLessThanOrEqual(300);
  });

  test("reflect stores cited cross-memory insights as conclusions and mirrors into reflections", async () => {
    const ids: string[] = [];
    for (const c of ["alice codes late at night", "alice drinks coffee after 10pm", "alice often feels tired in the morning"]) {
      ids.push((await addDerivedFact(db, { peer: "alice", content: c, category: "profile" })).id);
    }
    mock.handlers.reflect = () => ({
      insights: [
        { content: "alice's late-night coding and coffee habit likely cause her morning tiredness", source_ids: ids, confidence: 0.7 },
        { content: "unsupported insight", source_ids: ["nope"] },
      ],
    });
    const res = await reflectPeer(db, "alice", llm);
    expect(res.insights.length).toBe(1);
    const ins = getFactRow(db, res.insights[0].id)!;
    expect(ins.kind).toBe("insight");
    expect(ins.category).toBe("patterns");
    expect(ins.source_memory_ids.sort()).toEqual([...ids].sort());
    const mirrored = db.query("SELECT COUNT(*) AS c FROM reflections WHERE topic = 'peer:alice'").get() as any;
    expect(mirrored.c).toBe(1);
  });

  test("embeddings: OpenAI-compatible endpoint when configured, sparse-hash fallback otherwise", async () => {
    const saved = { url: CONFIG.EMBED_URL };
    try {
      CONFIG.EMBED_URL = mock.baseUrl;
      const v = await getEmbedding("hello world");
      expect(v.length).toBe(8);
      expect(mock.embedCalls).toBeGreaterThan(0);
      CONFIG.EMBED_URL = "http://127.0.0.1:9/v1";
      const fallback = await getEmbedding("hello world");
      expect(fallback.length).toBe(EMBEDDING_DIM);
    } finally {
      CONFIG.EMBED_URL = saved.url;
    }
  });
});
