/**
 * Real-model finding (gemini-2.5-flash-lite, max_tokens 900): the extraction reply for
 * an 8-message batch was pretty-printed JSON cut off at max_tokens. The parse error
 * failed the whole batch, and since the same input truncates the same way, it would
 * never succeed. Now: a truncated JSON reply raises LlmTruncatedError and the deriver
 * halves the batch until each half fits.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { LlmClient, LlmTruncatedError } from "../src/engine/llm.ts";
import { ingestMessages, queueStats } from "../src/engine/messages.ts";
import { runDeriverOnce } from "../src/engine/deriver.ts";
import { listFacts } from "../src/engine/facts.ts";
import { MockOpenAI, parseTranscript } from "./helpers/mock_openai.ts";

let mock: MockOpenAI;
beforeAll(() => {
  mock = new MockOpenAI();
});
afterAll(() => mock.stop());

describe("truncated JSON replies", () => {
  test("chatJSON: finish_reason=length + broken JSON -> LlmTruncatedError (not retried)", async () => {
    mock.reset();
    mock.handlers.summary = () => ({ __raw: '{"summary": "half a sen', __finish: "length" });
    const llm = new LlmClient({ url: mock.baseUrl, model: "m", backoffMs: 1, maxRetries: 2 });
    await expect(llm.chatJSON([{ role: "system", content: "living profile" }, { role: "user", content: "x" }])).rejects.toBeInstanceOf(LlmTruncatedError);
    expect(mock.callsOf("summary").length).toBe(1);
    // A complete JSON object that merely hit the limit afterwards still parses.
    mock.handlers.summary = () => ({ __raw: '{"summary": "ok"}', __finish: "length" });
    expect(await llm.chatJSON([{ role: "system", content: "living profile" }, { role: "user", content: "x" }])).toEqual({ summary: "ok" });
  });

  test("deriver halves a batch whose extraction reply truncates, and learns every fact", async () => {
    mock.reset();
    const db = new Database(":memory:");
    initSchema(db);
    const llm = new LlmClient({ url: mock.baseUrl, model: "m", backoffMs: 1, maxRetries: 0 });
    // The scripted model can only fit 2 messages' worth of facts in its token budget.
    mock.handlers.extract = (call) => {
      const lines = parseTranscript(call.user);
      if (lines.length > 2) return { __raw: '{"facts":[{"content":"dina works', __finish: "length" };
      return {
        facts: lines.map((m) => ({ content: `dina said: ${m.text}`, kind: "explicit", category: "profile", confidence: 0.9, source_message_ids: [m.id] })),
        session_summaries: {},
      };
    };
    const texts = ["works as a backend engineer", "writes Go and Rust", "runs 5 km every morning", "is vegetarian", "is learning Japanese", "volunteers teaching coding", "moved to Surabaya", "prefers async communication"];
    ingestMessages(db, texts.map((t, i) => ({ peer: "dina", session: "s1", role: "user", content: `I ${t} (${i})` })));
    const res = await runDeriverOnce(db, llm, { batchSize: 8 });
    expect(res.error).toBeNull();
    expect(res.failed).toBe(0);
    expect(res.batches.length).toBe(1);
    expect(res.batches[0].messages).toBe(8);
    expect(res.batches[0].added).toBe(8);
    expect(listFacts(db, "dina", { limit: 50 }).length).toBe(8);
    expect(queueStats(db).pending).toBe(0);
  });
});

describe("real-model reply shapes", () => {
  test("parseJsonReply keeps a complete object followed by degenerate junk", async () => {
    const { parseJsonReply } = await import("../src/engine/llm.ts");
    const junk = '{"facts":[{"content":"a } tricky \\" string {"}],"session_summaries":{"s1":"ok."}}\n}}\n."}}\njob."}}\n."}}';
    expect(parseJsonReply(junk)).toEqual({ facts: [{ content: 'a } tricky " string {' }], session_summaries: { s1: "ok." } });
    expect(() => parseJsonReply('{"facts":[{"content":"cut')).toThrow();
  });

  test("two UPDATE decisions on the same target: only the first supersedes it, the second is an ADD", async () => {
    mock.reset();
    const db = new Database(":memory:");
    initSchema(db);
    const llm = new LlmClient({ url: mock.baseUrl, model: "m", backoffMs: 1, maxRetries: 0 });
    const { addDerivedFact, getFactRow } = await import("../src/engine/facts.ts");
    const { idsIn } = await import("./helpers/mock_openai.ts");
    const old = await addDerivedFact(db, { peer: "dina", content: "dina lives in Surabaya", kind: "explicit", category: "profile" });
    mock.handlers.extract = (call) => ({
      facts: parseTranscript(call.user).map((m) => ({
        content: m.text.includes("Malang") ? "dina moved from Malang to Surabaya last year" : "dina moved to Surabaya for her job",
        kind: "explicit",
        category: "profile",
        confidence: 0.9,
        source_message_ids: [m.id],
      })),
      session_summaries: {},
    });
    mock.handlers.decide = (call) => {
      const target = idsIn(call.user).find((id) => id === old.id)!;
      return { decisions: [0, 1].map((index) => ({ index, action: "UPDATE", target_id: target, content: "" })) };
    };
    ingestMessages(db, [
      { peer: "dina", session: "s1", role: "user", content: "I moved from Malang to Surabaya last year" },
      { peer: "dina", session: "s1", role: "user", content: "I moved to Surabaya for my job here" },
    ]);
    const res = await runDeriverOnce(db, llm);
    expect(res.error).toBeNull();
    expect(mock.callsOf("decide").length).toBe(1);
    expect(res.batches[0].updated).toBe(1);
    expect(res.batches[0].added).toBe(1);
    const oldRow = db.query("SELECT is_active, superseded_by_id FROM memories WHERE id = ?").get(old.id) as any;
    expect(oldRow.is_active).toBe(0);
    expect(getFactRow(db, oldRow.superseded_by_id)?.is_active).toBeTruthy();
    expect(listFacts(db, "dina", { limit: 10 }).length).toBe(2);
  });
});
