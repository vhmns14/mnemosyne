/**
 * Per-vector embedding model id: vectors are only compared with vectors of the same
 * model (a silent local fallback or a provider switch used to score cosine across two
 * unrelated latent spaces of the same dimension), legacy DBs migrate in place, and
 * `reembed` brings mismatched rows onto the configured model.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { CONFIG } from "../src/config.ts";
import { rememberMemory } from "../src/engine/dialectic.ts";
import { searchHybrid } from "../src/engine/hybrid.ts";
import {
  configuredEmbeddingModel,
  embeddingModelOf,
  generateLocalEmbedding,
  getEmbedding,
  LOCAL_EMBEDDING_MODEL,
} from "../src/engine/embedder.ts";
import { reembedMismatched } from "../src/engine/reembed.ts";
import { MockOpenAI } from "./helpers/mock_openai.ts";

let mock: MockOpenAI;
beforeAll(() => {
  mock = new MockOpenAI();
});
afterAll(() => mock.stop());

function fresh(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function putVector(db: Database, id: string, vec: Float32Array, model: string | null) {
  db.prepare("INSERT OR REPLACE INTO memory_vectors (memory_id, vector, dimension, model) VALUES (?, ?, ?, ?)").run(
    id,
    Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
    vec.length,
    model
  );
}

describe("embedding model identity", () => {
  test("vectors are tagged with the model that really produced them (fallback = local)", async () => {
    const saved = CONFIG.EMBED_URL;
    try {
      CONFIG.EMBED_URL = mock.baseUrl;
      expect(configuredEmbeddingModel()).toBe(`compat:${CONFIG.EMBED_MODEL}`);
      expect(embeddingModelOf(await getEmbedding("hello"))).toBe(`compat:${CONFIG.EMBED_MODEL}`);
      CONFIG.EMBED_URL = "http://127.0.0.1:9/v1"; // down -> local fallback
      expect(embeddingModelOf(await getEmbedding("hello"))).toBe(LOCAL_EMBEDDING_MODEL);
    } finally {
      CONFIG.EMBED_URL = saved;
    }
  });

  test("new rows store their model id", async () => {
    const db = fresh();
    const id = await rememberMemory(db, { content: "the deploy target is fly.io" });
    const row = db.query("SELECT model, dimension FROM memory_vectors WHERE memory_id = ?").get(id) as any;
    expect(row.model).toBe(LOCAL_EMBEDDING_MODEL);
    expect(row.dimension).toBe(384);
  });

  test("dedupe never merges across models even when cross-model cosine would be 1.0", async () => {
    const db = fresh();
    const a = await rememberMemory(db, { content: "alpha unrelated memory about cats" });
    // Pretend A's stored vector came from a remote model whose vector happens to equal
    // the local embedding of B's text (same dimension, different space).
    const b = "zeta deploy pipeline uses bun and sqlite wal";
    putVector(db, a, generateLocalEmbedding(b), "compat:other-model");
    const idB = await rememberMemory(db, { content: b });
    expect(idB).not.toBe(a);
    const active = db.query("SELECT COUNT(*) AS c FROM memories WHERE is_active = 1").get() as any;
    expect(active.c).toBe(2);
  });

  test("recall ignores other-model vectors (lexical still finds the row)", async () => {
    const db = fresh();
    const a = await rememberMemory(db, { content: "kopi tubruk is the user's favourite coffee" });
    const decoy = await rememberMemory(db, { content: "completely unrelated gardening note" });
    const q = "favourite coffee kopi tubruk";
    // Decoy's foreign vector equals the query's local vector: cross-model this would rank it first.
    putVector(db, decoy, generateLocalEmbedding(q), "compat:other-model");
    const res = await searchHybrid(db, { query: q, limit: 5, min_relevance: 0 });
    expect(res[0].id).toBe(a);
    const d = res.find((r) => r.id === decoy);
    expect(d?.vector_score ?? 0).toBe(0);
  });

  test("legacy DB migrates in place: reproducible local vectors -> local, others -> unknown:legacy", async () => {
    const db = fresh();
    const local = await rememberMemory(db, { content: "legacy local row about wal mode" });
    const foreign = await rememberMemory(db, { content: "legacy row embedded remotely" });
    const wide = await rememberMemory(db, { content: "legacy 1536 dim row" });
    // Simulate the pre-migration table: no model column.
    db.exec("ALTER TABLE memory_vectors DROP COLUMN model");
    const rnd = new Float32Array(384).map((_, i) => Math.sin(i + 1));
    db.prepare("UPDATE memory_vectors SET vector = ?, dimension = 384 WHERE memory_id = ?").run(Buffer.from(rnd.buffer), foreign);
    const w = new Float32Array(1536).fill(0.01);
    db.prepare("UPDATE memory_vectors SET vector = ?, dimension = 1536 WHERE memory_id = ?").run(Buffer.from(w.buffer), wide);

    initSchema(db); // migration runs on open
    const model = (id: string) => (db.query("SELECT model FROM memory_vectors WHERE memory_id = ?").get(id) as any).model;
    expect(model(local)).toBe(LOCAL_EMBEDDING_MODEL);
    expect(model(foreign)).toBe("unknown:legacy");
    expect(model(wide)).toBe("unknown:legacy");
    initSchema(db); // idempotent
    expect(model(local)).toBe(LOCAL_EMBEDDING_MODEL);
  });

  test("reembed: dry run counts, provider down writes nothing, provider up converts rows", async () => {
    const db = fresh();
    for (const c of ["one fact", "two fact", "three fact"]) await rememberMemory(db, { content: c });
    const saved = CONFIG.EMBED_URL;
    try {
      CONFIG.EMBED_URL = mock.baseUrl;
      const target = configuredEmbeddingModel();
      const dry = await reembedMismatched(db, { dryRun: true });
      expect(dry.mismatched).toBe(3);
      expect(dry.by_model[LOCAL_EMBEDDING_MODEL]).toBe(3);

      CONFIG.EMBED_URL = "http://127.0.0.1:9/v1";
      // target is computed from config, so point config at the down endpoint but same model id
      const down = await reembedMismatched(db, { maxFailures: 2 });
      expect(down.reembedded).toBe(0);
      expect(down.stopped_early).toBe(true);
      expect((db.query("SELECT COUNT(*) AS c FROM memory_vectors WHERE model = ?").get(target) as any).c).toBe(0);

      CONFIG.EMBED_URL = mock.baseUrl;
      const up = await reembedMismatched(db);
      expect(up.reembedded).toBe(3);
      expect((db.query("SELECT COUNT(*) AS c FROM memory_vectors WHERE model = ?").get(target) as any).c).toBe(3);
      expect((await reembedMismatched(db, { dryRun: true })).mismatched).toBe(0);
    } finally {
      CONFIG.EMBED_URL = saved;
    }
  });
});
