/**
 * Reflect quality gate: insights that restate one fact, duplicate an existing insight,
 * or rest on fewer than 2 distinct (non-near-duplicate) facts are rejected; accepted
 * insights reach the peer card only at trust >= 0.6 (MNEMO_INSIGHT_CARD_TRUST) or after
 * re-observation. Fake LLM only.
 */
import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { CONFIG } from "../src/config.ts";
import { LlmClient } from "../src/engine/llm.ts";
import { addDerivedFact, cardFacts, factFeedback, getFactRow } from "../src/engine/facts.ts";
import { reflectPeer } from "../src/engine/insights.ts";
import { comparable, nearDuplicate } from "../src/engine/insight_quality.ts";
import { MockOpenAI } from "./helpers/mock_openai.ts";

let mock: MockOpenAI;
let db: Database;
let llm: LlmClient;
beforeAll(() => {
  mock = new MockOpenAI();
});
afterAll(() => mock.stop());
beforeEach(() => {
  mock.reset();
  db = new Database(":memory:");
  initSchema(db);
  llm = new LlmClient({ url: mock.baseUrl, model: "mock-model", backoffMs: 1, maxRetries: 0 });
});

async function seed() {
  const add = async (content: string) => (await addDerivedFact(db, { peer: "alice", content, category: "profile" })).id;
  return {
    A: await add("alice codes late at night"),
    B: await add("alice drinks coffee after 10pm"),
    C: await add("alice often feels tired in the morning"),
    D: await add("alice usually writes code late at night"), // near-duplicate of A
  };
}

const GOOD = "alice's late-night coding and coffee habit likely cause her morning tiredness";

describe("reflect quality gate", () => {
  test("rejects restatements, near-duplicate sources and duplicate insights; keeps a real synthesis", async () => {
    const { A, B, C, D } = await seed();
    mock.handlers.reflect = () => ({
      insights: [
        { content: "Alice codes late at night.", source_ids: [A, B], confidence: 0.8 },
        { content: "a recurring nocturnal programming routine", source_ids: [A, D], confidence: 0.8 },
        { content: GOOD, source_ids: [A, B, C], confidence: 0.7 },
        { content: "alice's late night coding and coffee habits likely cause her tiredness in the morning", source_ids: [A, B, C], confidence: 0.7 },
      ],
    });
    const res = await reflectPeer(db, "alice", llm);
    expect(res.insights.map((i) => i.content)).toEqual([GOOD]);
    const reasons = res.rejected!.map((r) => r.reason);
    expect(reasons[0]).toMatch(/restates a single fact/);
    expect(reasons[1]).toMatch(/needs >= 2 distinct source facts \(cited 2, distinct 1\)/);
    expect(reasons[2]).toMatch(/duplicates an existing insight/);
    expect(db.query("SELECT COUNT(*) AS c FROM reflections WHERE topic = 'peer:alice'").get()).toEqual({ c: 1 });

    // A later run proposing the same insight from the same facts is refused, not stored twice.
    mock.handlers.reflect = () => ({ insights: [{ content: GOOD.replace("likely", "probably"), source_ids: [A, B, C] }] });
    const again = await reflectPeer(db, "alice", llm);
    expect(again.insights.length).toBe(0);
    expect(again.reobserved).toEqual([]);
    expect(again.rejected![0].reason).toMatch(/duplicates an existing insight/);
  });

  test("insights reach the card only above the trust threshold or after re-observation", async () => {
    const { A, B, C } = await seed();
    mock.handlers.reflect = () => ({ insights: [{ content: GOOD, source_ids: [A, B, C], confidence: 0.8 }] });
    const id = (await reflectPeer(db, "alice", llm)).insights[0].id;
    expect(getFactRow(db, id)!.trust).toBe(0.5);
    const inCard = () => cardFacts(db, "alice", 50).some((f) => f.id === id);
    expect(inCard()).toBe(false); // plain facts at 0.5 are in, the insight is not
    expect(cardFacts(db, "alice", 50).some((f) => f.id === A)).toBe(true);

    factFeedback(db, id, "helpful"); // 0.55
    expect(inCard()).toBe(false);
    factFeedback(db, id, "helpful"); // 0.60
    expect(inCard()).toBe(true);

    process.env.MNEMO_INSIGHT_CARD_TRUST = "0.9";
    try {
      expect(inCard()).toBe(false);
      // re-observation: reflect re-derives the same insight from a new source fact
      const E = (await addDerivedFact(db, { peer: "alice", content: "alice skips breakfast on weekdays", category: "profile" })).id;
      mock.handlers.reflect = () => ({ insights: [{ content: GOOD, source_ids: [A, E] }] });
      const re = await reflectPeer(db, "alice", llm);
      expect(re.reobserved).toEqual([id]);
      expect(re.insights.length).toBe(0);
      expect(getFactRow(db, id)!.observations).toBe(2);
      expect(inCard()).toBe(true);
    } finally {
      delete process.env.MNEMO_INSIGHT_CARD_TRUST;
    }
  });

  test("semantic near-duplicate path (same-model cosine) is honoured", async () => {
    const saved = CONFIG.EMBED_URL;
    try {
      CONFIG.EMBED_URL = mock.baseUrl; // mock returns one constant vector: cosine 1.0 for any pair
      const a = await comparable("she relocated to the capital");
      const b = await comparable("moved to Jakarta last spring");
      expect(nearDuplicate(a, b)).toMatch(/cosine 1\.00/);
    } finally {
      CONFIG.EMBED_URL = saved;
    }
    const a = await comparable("she relocated to the capital");
    const b = await comparable("prefers green tea over coffee");
    expect(nearDuplicate(a, b)).toBeNull();
  });
});
