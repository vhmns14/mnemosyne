import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { extractTriples } from "../src/engine/dialectic.ts";

describe("Dreamer, Ingestion & Watermark Production Hardening Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  it("1. rememberMemory and mnemo add populate notes table for delta dreaming", async () => {
    // Initial notes count must be 0
    const initialNotes = db.query("SELECT COUNT(*) as count FROM notes").get() as any;
    expect(initialNotes.count).toBe(0);

    // Explicitly add memory
    await engine.remember({
      content: "Kita menggunakan Bun runtime untuk microservice",
      peer: "vahmi",
      source_session: "session_init",
    });

    // Notes table must now have this memory in its episodic timeline
    const notesAfter = db.query("SELECT * FROM notes").all() as any[];
    expect(notesAfter.length).toBe(1);
    expect(notesAfter[0].content).toContain("Kita menggunakan Bun runtime");
    expect(notesAfter[0].peer).toBe("vahmi");

    // Dreamer pass must find this note in delta notes
    const dream = await engine.dream({ force: true });
    expect(dream.input_delta_count).toBe(1);
    expect(dream.facts_reinforced).toBeGreaterThanOrEqual(1);
  });

  it("2. Ingest raw notes without auto-promoting unless is_fact is set", async () => {
    // Ingest raw conversation note without is_fact
    const rawIngest = await engine.ingest({
      content: "Dek suka kopi susu gula aren",
      peer: "hermes",
      session_id: "chat_sess_1",
    });

    expect(rawIngest.stored_in_notes).toBe(true);
    expect(rawIngest.stored_in_facts).toBe(false);
    expect(rawIngest.action).toBe("ingested_note");

    // Dreamer pass then processes the raw note and promotes it to facts
    const dream = await engine.dream({ force: true });
    expect(dream.input_delta_count).toBe(1);
    expect(dream.facts_added).toBeGreaterThanOrEqual(1);

    // Verify fact content maintains Indonesian language ("suka", not "likes")
    const fact = db.query("SELECT content FROM memories WHERE is_active = 1").get() as any;
    expect(fact).toBeDefined();
    expect(fact.content).toContain("suka");
    expect(fact.content).not.toContain("likes");
  });

  it("3. Watermark reset allows re-processing delta notes for LLM or re-evaluation", async () => {
    await engine.ingest({
      content: "Vahmi selalu prefer Postgres untuk database relasional",
      peer: "vahmi",
      session_id: "db_pref",
    });

    // Run first dream pass -> watermark advances
    const dream1 = await engine.dream({ force: true });
    expect(dream1.input_delta_count).toBe(1);

    // Second run without new notes -> delta is 0
    const dream2 = await engine.dream({ force: false });
    expect(dream2.input_delta_count).toBe(0);

    // Third run with reset_watermark: true -> re-evaluates all notes!
    const dream3 = await engine.dream({ reset_watermark: true, force: true });
    expect(dream3.input_delta_count).toBe(1);
    expect(dream3.facts_reinforced).toBeGreaterThanOrEqual(1);
  });

  it("4. Content extraction preserves original Indonesian predicates faithfully", async () => {
    const triples = extractTriples("Dek suka ngoding larut malam");
    expect(triples.length).toBeGreaterThan(0);
    expect(triples[0].subject).toBe("Dek");
    expect(triples[0].predicate).toBe("LIKES");
    expect(triples[0].raw_predicate).toBe("suka");

    const upsertRes = await engine.upsertFact({
      subject: triples[0].subject,
      predicate: triples[0].predicate,
      raw_predicate: triples[0].raw_predicate,
      object: triples[0].object,
      content: "Dek suka ngoding larut malam",
    });

    expect(upsertRes.action).toBe("inserted");
    const mem = db.query("SELECT content FROM memories WHERE id = ?").get(upsertRes.memory_id) as any;
    expect(mem.content).toBe("Dek suka ngoding larut malam");
  });

  it("5. Tracks facts_reinforced when facts are already present or repeated", async () => {
    await engine.remember({
      content: "Vahmi suka framework Fastify",
      peer: "vahmi",
    });

    // Ingest another note saying the exact same preference
    await engine.ingest({
      content: "Vahmi suka framework Fastify",
      peer: "vahmi",
    });

    const dream = await engine.dream({ force: true });
    expect(dream.facts_reinforced).toBeGreaterThanOrEqual(1);
  });
});
