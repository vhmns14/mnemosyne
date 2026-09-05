import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { runLongMemEval, formatBenchmarkReport, LONGMEMEVAL_CASES } from "../src/engine/benchmark.ts";

describe("Mnemosyne Fase 11: LongMemEval Standardized Benchmark Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  test("runs LongMemEval across all 5 dimensions and achieves >= 85% accuracy", async () => {
    const report = await runLongMemEval(engine, LONGMEMEVAL_CASES);

    expect(report.total_cases).toBe(LONGMEMEVAL_CASES.length);
    expect(report.overall_accuracy).toBeGreaterThanOrEqual(0.85);
    expect(report.verdict).toBe("PASSED");

    // Check all 5 dimensions exist
    expect(report.dimension_scores.information_extraction.accuracy).toBeGreaterThanOrEqual(0.5);
    expect(report.dimension_scores.multi_session_reasoning.accuracy).toBeGreaterThanOrEqual(0.5);
    expect(report.dimension_scores.knowledge_updates.accuracy).toBeGreaterThanOrEqual(0.5);
    expect(report.dimension_scores.temporal_reasoning.accuracy).toBeGreaterThanOrEqual(0.5);
    expect(report.dimension_scores.abstention.accuracy).toBeGreaterThanOrEqual(0.5);

    // Formatted report string contains key sections
    const formatted = formatBenchmarkReport(report);
    expect(formatted).toContain("LONGMEMEVAL BENCHMARK REPORT");
    expect(formatted).toContain("PASSED");
    expect(formatted).toContain("Hallucination Abstention");
  });
});
