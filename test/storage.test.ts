import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";

describe("Mnemosyne Core Storage & Schema", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  test("initializes schema and tables properly", () => {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain("memories");
    expect(tables).toContain("memory_vectors");
    expect(tables).toContain("entity_triples");
    expect(tables).toContain("associative_links");
    expect(tables).toContain("personas");
  });

  test("stores memory and retrieves via recall", async () => {
    const id = await engine.remember({
      content: "Laptop RAM 16GB, hindari background build",
      category: "hardware",
      importance: "critical",
      scope: "global",
      tags: ["ram", "hardware"],
    });

    expect(id).toBeDefined();

    const res = await engine.recall({
      query: "aturan ram laptop",
      limit: 3,
    });

    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories[0].content).toContain("RAM 16GB");
    expect(res.memories[0].importance).toBe("critical");
  });

  test("stores and updates theory of mind persona", () => {
    const persona = engine.getPersona("user");
    expect(persona.entity_type).toBe("user");
    expect(persona.hard_constraints.length).toBeGreaterThan(0);
    expect(persona.hard_constraints[0]).toContain("RAM 16GB");
  });
});
