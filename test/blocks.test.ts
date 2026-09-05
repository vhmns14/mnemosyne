import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { 
  getContextBlock, setContextBlock, appendContextBlock, 
  listContextBlocks, deleteContextBlock 
} from "../src/engine/blocks.ts";

describe("Mnemosyne Fase 13: Dynamic Working Memory Blocks Suite (Letta/MemGPT Style)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  test("initializes default context blocks automatically", () => {
    const blocks = listContextBlocks(db);
    expect(blocks.length).toBeGreaterThanOrEqual(3);

    const names = blocks.map((b) => b.name);
    expect(names).toContain("active_task");
    expect(names).toContain("scratchpad");
    expect(names).toContain("user_profile");
  });

  test("getContextBlock and setContextBlock updates content and respects limit", () => {
    const updated = setContextBlock(db, "active_task", "Refactoring database indexes for v1.5 release", 100);
    expect(updated.name).toBe("active_task");
    expect(updated.content).toBe("Refactoring database indexes for v1.5 release");
    expect(updated.token_limit).toBe(100);

    const retrieved = getContextBlock(db, "active_task");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.content).toBe("Refactoring database indexes for v1.5 release");
  });

  test("appendContextBlock appends new lines cleanly", () => {
    setContextBlock(db, "scratchpad", "Step 1: Check git status", 300);
    const updated = appendContextBlock(db, "scratchpad", "Step 2: Run test suite");

    expect(updated.content).toContain("Step 1: Check git status");
    expect(updated.content).toContain("Step 2: Run test suite");
  });

  test("creates and deletes custom context blocks", () => {
    setContextBlock(db, "project_guidelines", "Always keep RAM under 35MB", 250);
    expect(getContextBlock(db, "project_guidelines")?.content).toContain("RAM under 35MB");

    const deleted = deleteContextBlock(db, "project_guidelines");
    expect(deleted).toBe(true);
    expect(getContextBlock(db, "project_guidelines")).toBeNull();
  });
});
