/**
 * Paraphrase recall with the local embedder: bilingual stem/synonym lexical leg plus
 * LLM query expansion (bounded, cached, fail-open). Uses a fake LLM only.
 */
import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { rememberMemory } from "../src/engine/dialectic.ts";
import { searchHybrid } from "../src/engine/hybrid.ts";
import { LlmClient } from "../src/engine/llm.ts";
import { lexicalTokens, lexicalKeySet, lexicalCoverage } from "../src/engine/lexicon.ts";
import { expandQuery, expansionStrings, clearExpansionCache } from "../src/engine/query_expansion.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { runParaphraseEval, HELDOUT_PAIRS, PARAPHRASE_PAIRS } from "../bench/paraphrase_eval.ts";
import { MockOpenAI } from "./helpers/mock_openai.ts";

let mock: MockOpenAI;
let slow: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  mock = new MockOpenAI();
  slow = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async () => { await Bun.sleep(3000); return new Response("{}"); } });
});
afterAll(() => {
  mock.stop();
  slow.stop(true);
});
beforeEach(() => {
  mock.reset();
  clearExpansionCache();
});

const fakeLlm = (url = mock.baseUrl) => new LlmClient({ url, model: "fake-expander", maxRetries: 0, backoffMs: 1 });
const stems = (w: string) => Array.from(lexicalTokens(w)[0]?.keys ?? []);

describe("bilingual lexicon", () => {
  test("Indonesian affixes and English suffixes reduce to shared keys", () => {
    expect(stems("berwisata")).toContain("wisata");
    expect(stems("pekerjaan")).toContain("kerja");
    expect(stems("bekerja")).toContain("kerja");
    expect(stems("membaca")).toContain("baca");
    expect(stems("perjalanan")).toContain("jalan");
    expect(stems("istrinya")).toContain("istri");
    expect(stems("dimakan")).toContain("makan");
    expect(stems("mengirimkan")).toContain("kirim");
    expect(stems("jogging")).toContain("jog");
    expect(stems("moved")).toContain("move");
    expect(stems("married")).toContain("marry");
    expect(stems("allergies")).toContain("allergy");
  });

  test("synonym groups bridge languages at partial weight", () => {
    const q = lexicalTokens("travel plans");
    const doc = lexicalKeySet("Raka is going on a trip to Kyoto");
    const cov = lexicalCoverage(q, doc);
    expect(cov).toBeGreaterThan(0);
    expect(cov).toBeLessThan(1); // synonym-only match is not a full hit
    expect(lexicalCoverage(lexicalTokens("rencana liburan"), lexicalKeySet("akan berwisata ke Bali"))).toBeGreaterThan(0);
  });

  test("eval: lexicon beats the old lexical leg on main and held-out pairs", async () => {
    for (const pairs of [PARAPHRASE_PAIRS, HELDOUT_PAIRS]) {
      const before = await runParaphraseEval("before", null, pairs);
      const after = await runParaphraseEval("lexicon", null, pairs);
      expect(after.hit3).toBeGreaterThan(before.hit3);
      expect(after.mrr).toBeGreaterThan(before.mrr + 0.3);
    }
  });
});

describe("LLM query expansion", () => {
  test("bounded request, sanitised output, cached", async () => {
    mock.handlers.expand = () => ({ paraphrases: ["usual coffee order", "usual coffee order", "x".repeat(500), 42], keywords: ["coffee", "latte", "kopi"] });
    const llm = fakeLlm();
    const a = await expandQuery("favorite drink", llm);
    expect(a.source).toBe("llm");
    expect(a.paraphrases[0]).toBe("usual coffee order");
    expect(a.paraphrases.length).toBe(2); // deduped, non-strings dropped
    expect(a.paraphrases[1].length).toBeLessThanOrEqual(80);
    expect(a.keywords).toEqual(["coffee", "latte", "kopi"]);
    const call = mock.callsOf("expand")[0];
    expect(call.body.max_tokens).toBeLessThanOrEqual(300);
    expect(call.user).toContain("favorite drink");
    const b = await expandQuery("Favorite drink ", llm);
    expect(b.source).toBe("cache");
    expect(mock.callsOf("expand").length).toBe(1);
  });

  test("fail-open: HTTP error, malformed reply, timeout, disabled, no LLM", async () => {
    mock.failNext = 1;
    expect((await expandQuery("q1", fakeLlm())).source).toBe("none");
    mock.handlers.expand = () => ({ __raw: "not json at all" });
    expect((await expandQuery("q2", fakeLlm())).source).toBe("none");
    const t0 = Date.now();
    expect((await expandQuery("q3", fakeLlm(`http://127.0.0.1:${slow.port}/v1`), { timeoutMs: 200 })).source).toBe("none");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((await expandQuery("q4", null)).source).toBe("none");
    process.env.MNEMO_QUERY_EXPANSION = "off";
    try {
      mock.handlers.expand = () => ({ paraphrases: ["p"], keywords: [] });
      const before = mock.calls.length;
      expect((await expandQuery("q5", fakeLlm())).source).toBe("none");
      expect(mock.calls.length).toBe(before);
    } finally {
      delete process.env.MNEMO_QUERY_EXPANSION;
    }
  });

  test("expansions rescue a query the lexicon alone misses", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const target = await rememberMemory(db, { content: "Every morning Sari orders an oat latte" });
    await rememberMemory(db, { content: "The production database runs PostgreSQL 16" });
    const plain = await searchHybrid(db, { query: "favorite drink", limit: 5, min_relevance: 0 });
    expect(plain[0]?.id).not.toBe(target);
    mock.handlers.expand = () => ({ paraphrases: ["usual coffee order"], keywords: ["coffee", "latte"] });
    const expansions = expansionStrings(await expandQuery("favorite drink", fakeLlm()));
    const expanded = await searchHybrid(db, { query: "favorite drink", limit: 5, min_relevance: 0, expansions });
    expect(expanded[0]?.id).toBe(target);
  });

  test("engine.recall expands with the configured LLM once (then cache)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const engine = new MnemosyneEngine(db);
    const target = await engine.remember({ content: "Every morning Sari orders an oat latte" });
    mock.handlers.expand = () => ({ paraphrases: ["usual coffee order"], keywords: ["coffee", "latte"] });
    const prev = process.env.MNEMO_LLM_URL;
    const prevModel = process.env.MNEMO_LLM_MODEL;
    process.env.MNEMO_LLM_URL = mock.baseUrl;
    process.env.MNEMO_LLM_MODEL = "fake-expander";
    try {
      const r1 = await engine.recall({ query: "favorite drink", limit: 3, min_relevance: 0 });
      expect(r1.memories[0]?.id).toBe(target);
      await engine.recall({ query: "favorite drink", limit: 3, min_relevance: 0 });
      expect(mock.callsOf("expand").length).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.MNEMO_LLM_URL;
      else process.env.MNEMO_LLM_URL = prev;
      if (prevModel === undefined) delete process.env.MNEMO_LLM_MODEL;
      else process.env.MNEMO_LLM_MODEL = prevModel;
    }
  });
});
