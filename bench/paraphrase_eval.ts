#!/usr/bin/env bun
/**
 * Paraphrase recall eval: 15 query/fact pairs where the query and the stored fact use
 * different words (English + Indonesian), plus distractor facts. Measures hit@1,
 * hit@3 and MRR of searchHybrid with the default local embedder in three modes:
 *   before   : MNEMO_LEXICON=off, no query expansion (the old behaviour)
 *   lexicon  : bilingual stem/synonym lexical leg on, no expansion
 *   expanded : lexicon + LLM query expansion (needs MNEMO_LLM_URL / MNEMO_LLM_MODEL)
 *
 *   bun bench/paraphrase_eval.ts            # before + lexicon (+ expanded if an LLM is configured)
 *
 * The test suite imports runParaphraseEval() with a fake LLM.
 */
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { rememberMemory } from "../src/engine/dialectic.ts";
import { searchHybrid } from "../src/engine/hybrid.ts";
import { expandQuery, expansionStrings, clearExpansionCache } from "../src/engine/query_expansion.ts";
import type { LlmClient } from "../src/engine/llm.ts";

export const PARAPHRASE_PAIRS: Array<{ query: string; fact: string }> = [
  { query: "travel plans", fact: "Raka is going on a trip to Kyoto in April" },
  { query: "where does Dina work", fact: "Dina is employed as a nurse at Siloam hospital" },
  { query: "what pets does Budi have", fact: "Budi has two cats named Mochi and Kopi" },
  { query: "favorite drink", fact: "Every morning Sari orders an oat latte" },
  { query: "rencana liburan Andi", fact: "Andi akan berwisata ke Bali bulan depan" },
  { query: "pekerjaan istrinya", fact: "Istri Vahmi bekerja sebagai dosen" },
  { query: "food allergies", fact: "Tono is allergic to peanuts" },
  { query: "where does Raka live now", fact: "Raka moved to Jakarta last month" },
  { query: "exercise routine", fact: "Maya goes jogging at the park every Saturday" },
  { query: "kendaraan yang dimiliki", fact: "Dia punya mobil Honda Jazz warna merah" },
  { query: "music taste", fact: "Leo listens to a lot of jazz and indie bands" },
  { query: "when is the wedding", fact: "Tia is getting married on June 12" },
  { query: "programming languages he uses", fact: "Vahmi writes most of his code in TypeScript and Go" },
  { query: "hobi membaca", fact: "Sinta suka baca novel misteri sebelum tidur" },
  { query: "study background", fact: "Raka graduated from Universitas Gadjah Mada" },
];

/**
 * Held-out pairs, written after the synonym table was frozen and never used to tune
 * it: the honest number for the lexicon leg (the 15 pairs above informed it).
 */
export const HELDOUT_PAIRS: Array<{ query: string; fact: string }> = [
  { query: "vacation spot", fact: "Nina spent her holiday in Lombok last year" },
  { query: "tempat kerja suaminya", fact: "Suami Lia jadi guru di SMA Negeri 3" },
  { query: "does she have a dog", fact: "Lina adopted a puppy called Bento" },
  { query: "olahraga favorit", fact: "Fajar rutin lari pagi setiap Minggu" },
  { query: "his salary", fact: "Doni earns about 15 million rupiah a month" },
  { query: "kapan ulang tahunnya", fact: "Rizal lahir tanggal 3 Maret" },
  { query: "what car does she drive", fact: "Mira drives a white Toyota Avanza" },
  { query: "languages spoken", fact: "Ken speaks Japanese fluently" },
  { query: "sedang belajar apa", fact: "Putri sedang kuliah jurusan arsitektur" },
  { query: "coffee habits", fact: "Ari drinks two cups of espresso before noon" },
];

export const DISTRACTORS: string[] = [
  "The production database runs PostgreSQL 16 on a dedicated host",
  "Deploys go out every Tuesday after the standup",
  "The office wifi password rotates monthly",
  "Rina prefers dark mode in every editor",
  "The quarterly report is due at the end of March",
  "Server logs are kept for thirty days",
  "Bayu is learning to play the guitar",
  "The team uses Linear for issue tracking",
  "Kantor pindah ke lantai lima minggu lalu",
  "Laptop kerja memakai Ubuntu 24.04",
];

export interface EvalMetrics {
  mode: string;
  hit1: number;
  hit3: number;
  mrr: number;
  ranks: number[];
}

export async function runParaphraseEval(
  mode: "before" | "lexicon" | "expanded",
  llm: LlmClient | null = null,
  pairs: Array<{ query: string; fact: string }> = PARAPHRASE_PAIRS
): Promise<EvalMetrics> {
  const prevLex = process.env.MNEMO_LEXICON;
  process.env.MNEMO_LEXICON = mode === "before" ? "off" : "on";
  try {
    const db = new Database(":memory:");
    initSchema(db);
    const ids: string[] = [];
    for (const p of pairs) ids.push(await rememberMemory(db, { content: p.fact, scope: "global" }));
    for (const d of DISTRACTORS) await rememberMemory(db, { content: d, scope: "global" });
    clearExpansionCache();
    const ranks: number[] = [];
    for (let i = 0; i < pairs.length; i++) {
      const q = pairs[i].query;
      const expansions = mode === "expanded" ? expansionStrings(await expandQuery(q, llm)) : [];
      const res = await searchHybrid(db, { query: q, limit: 10, min_relevance: 0, scope: "all", expansions, enable_resonance: false } as any);
      const r = res.findIndex((m) => m.id === ids[i]);
      ranks.push(r < 0 ? 0 : r + 1);
    }
    const n = ranks.length;
    return {
      mode,
      hit1: ranks.filter((r) => r === 1).length / n,
      hit3: ranks.filter((r) => r >= 1 && r <= 3).length / n,
      mrr: ranks.reduce((s, r) => s + (r ? 1 / r : 0), 0) / n,
      ranks,
    };
  } finally {
    if (prevLex === undefined) delete process.env.MNEMO_LEXICON;
    else process.env.MNEMO_LEXICON = prevLex;
  }
}

if (import.meta.main) {
  const { LlmClient } = await import("../src/engine/llm.ts");
  const fmt = (m: EvalMetrics) => `${m.mode.padEnd(9)} hit@1=${m.hit1.toFixed(2)} hit@3=${m.hit3.toFixed(2)} MRR=${m.mrr.toFixed(3)} ranks=${m.ranks.join(",")}`;
  const llm = LlmClient.fromEnv();
  for (const [name, pairs] of [["main (15)", PARAPHRASE_PAIRS], ["held-out (10)", HELDOUT_PAIRS]] as const) {
    console.log(`== ${name}`);
    console.log(fmt(await runParaphraseEval("before", null, pairs)));
    console.log(fmt(await runParaphraseEval("lexicon", null, pairs)));
    if (llm) console.log(fmt(await runParaphraseEval("expanded", llm, pairs)) + `  (model ${llm.model})`);
    else console.log("expanded  skipped: set MNEMO_LLM_URL + MNEMO_LLM_MODEL to measure LLM query expansion");
  }
}
