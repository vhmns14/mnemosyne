/**
 * Legacy vectors whose model cannot be proven are tagged "unknown:legacy" (never the
 * remote model that happens to be configured at upgrade time), are excluded from
 * vector comparisons until re-embedded, are handled by `reembed` by default, can be
 * proven by a sample re-embed (cosine >= 0.99 => tagged with that model), and the
 * daemon prints a one-line hint when any exist.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema, LEGACY_UNKNOWN_MODEL, countLegacyUnknownVectors } from "../src/db/schema.ts";
import { CONFIG } from "../src/config.ts";
import { rememberMemory } from "../src/engine/dialectic.ts";
import { searchHybrid } from "../src/engine/hybrid.ts";
import { configuredEmbeddingModel, generateLocalEmbedding, LOCAL_EMBEDDING_MODEL } from "../src/engine/embedder.ts";
import { reembedMismatched, verifyLegacyVectors, legacyVectorHint } from "../src/engine/reembed.ts";
import { MockOpenAI } from "./helpers/mock_openai.ts";

let mock: MockOpenAI;
let dir: string;
beforeAll(() => {
  mock = new MockOpenAI();
  dir = mkdtempSync(join(tmpdir(), "mnemo-legacy-"));
});
afterAll(() => {
  mock.stop();
  rmSync(dir, { recursive: true, force: true });
});

const fresh = () => {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
};
const put = (db: Database, id: string, vec: Float32Array, model: string | null) =>
  db.prepare("INSERT OR REPLACE INTO memory_vectors (memory_id, vector, dimension, model) VALUES (?, ?, ?, ?)").run(id, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), vec.length, model);
const modelOf = (db: Database, id: string) => (db.query("SELECT model FROM memory_vectors WHERE memory_id = ?").get(id) as any)?.model;
const MOCK_VEC = (() => {
  const v = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
})();

async function withRemote<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const saved = CONFIG.EMBED_URL;
  CONFIG.EMBED_URL = url;
  try {
    return await fn();
  } finally {
    CONFIG.EMBED_URL = saved;
  }
}

describe("legacy vector attribution", () => {
  test("migration never guesses the configured remote model; old placeholder is renamed", async () => {
    const db = fresh();
    const local = await rememberMemory(db, { content: "legacy local row about wal mode" });
    const foreign = await rememberMemory(db, { content: "legacy row embedded remotely" });
    const placeholder = await rememberMemory(db, { content: "row tagged by the previous migration" });
    db.exec("ALTER TABLE memory_vectors DROP COLUMN model");
    db.exec("ALTER TABLE memory_vectors ADD COLUMN model TEXT");
    put(db, local, generateLocalEmbedding("legacy local row about wal mode"), null);
    put(db, foreign, MOCK_VEC, null); // same dim as the configured remote model, but unprovable
    put(db, placeholder, MOCK_VEC, "legacy:unknown");
    // The upgrade happens while a remote model is configured: it must still not be guessed.
    await withRemote(mock.baseUrl, async () => initSchema(db));
    expect(modelOf(db, local)).toBe(LOCAL_EMBEDDING_MODEL);
    expect(modelOf(db, foreign)).toBe(LEGACY_UNKNOWN_MODEL);
    expect(modelOf(db, placeholder)).toBe(LEGACY_UNKNOWN_MODEL);
    expect(countLegacyUnknownVectors(db)).toBe(2);
  });

  test("unknown:legacy rows are excluded from vector scoring (lexical fallback still finds them)", async () => {
    const db = fresh();
    const q = "sqlite wal checkpoint cadence";
    const id = await rememberMemory(db, { content: "The sqlite wal checkpoint cadence is every 1000 pages" });
    put(db, id, generateLocalEmbedding(q), LEGACY_UNKNOWN_MODEL); // would be a perfect cosine match
    const res = await searchHybrid(db, { query: q, limit: 5, min_relevance: 0 });
    const hit = res.find((r) => r.id === id);
    expect(hit).toBeDefined();
    expect(hit?.vector_score ?? 0).toBe(0);
  });

  test("reembed handles unknown:legacy by default (no --force)", async () => {
    const db = fresh();
    const id = await rememberMemory(db, { content: "a legacy fact" });
    put(db, id, MOCK_VEC, LEGACY_UNKNOWN_MODEL);
    const dry = await reembedMismatched(db, { dryRun: true });
    expect(dry.by_model[LEGACY_UNKNOWN_MODEL]).toBe(1);
    const run = await reembedMismatched(db); // local target
    expect(run.reembedded).toBeGreaterThanOrEqual(1);
    expect(modelOf(db, id)).toBe(LOCAL_EMBEDDING_MODEL);
  });

  test("sample re-embed: cosine >= 0.99 tags with the configured model, others stay unknown", async () => {
    const db = fresh();
    const same = await rememberMemory(db, { content: "vector really from the remote model" });
    const other = await rememberMemory(db, { content: "vector from some other model" });
    put(db, same, MOCK_VEC, LEGACY_UNKNOWN_MODEL);
    put(db, other, new Float32Array([0.8, -0.1, 0.05, 0.3, -0.5, 0.0, 0.1, 0.02]), LEGACY_UNKNOWN_MODEL);
    // no remote configured: nothing to prove against
    const skipped = await verifyLegacyVectors(db);
    expect(skipped.skipped_reason).toMatch(/no remote/);
    expect(modelOf(db, same)).toBe(LEGACY_UNKNOWN_MODEL);
    await withRemote(mock.baseUrl, async () => {
      const target = configuredEmbeddingModel();
      const rep = await verifyLegacyVectors(db);
      expect(rep).toMatchObject({ checked: 2, tagged: 1, unmatched: 1 });
      expect(modelOf(db, same)).toBe(target);
      expect(modelOf(db, other)).toBe(LEGACY_UNKNOWN_MODEL);
    });
    await withRemote("http://127.0.0.1:9/v1", async () => {
      const down = await verifyLegacyVectors(db);
      expect(down.skipped_reason).toMatch(/unreachable/);
      expect(modelOf(db, other)).toBe(LEGACY_UNKNOWN_MODEL);
    });
  });

  test("daemon prints a one-line hint when unknown:legacy rows exist", async () => {
    const dbPath = join(dir, "hint.db");
    const db = new Database(dbPath);
    initSchema(db);
    const id = await rememberMemory(db, { content: "old fact" });
    put(db, id, MOCK_VEC, LEGACY_UNKNOWN_MODEL);
    expect(legacyVectorHint(db)).toMatch(/1 legacy vector\(s\).*mnemo reembed/);
    db.close();
    const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = s.port as number;
    s.stop(true);
    const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "src", "server.ts")], {
      env: { PATH: process.env.PATH || "", HOME: dir, MNEMO_DB_PATH: dbPath, MNEMO_PORT: String(port), MNEMO_DERIVER: "off", MNEMO_AUTH_TOKEN: "t", NO_PROXY: "127.0.0.1,localhost" },
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
      } catch {}
      await Bun.sleep(100);
    }
    proc.kill();
    const err = await new Response(proc.stderr).text();
    const lines = err.split("\n").filter((l) => l.includes("legacy vector"));
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/mnemo reembed/);
  });
});
