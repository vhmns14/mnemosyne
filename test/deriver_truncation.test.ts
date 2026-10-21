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
