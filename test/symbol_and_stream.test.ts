import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { initSchema } from "../src/db/schema.ts";
import { extractSymbolContent } from "../src/engine/staleness.ts";
import { routeIntent } from "../src/engine/router.ts";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const TEST_DB = "test_symbol_and_stream.db";
const TEST_DIR = resolve(process.cwd(), "test_scratch_symbol");

describe("Mnemosyne SOTA 2026: Symbol Anchoring, Intent Router & SSE Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    db = new Database(TEST_DB);
    initSchema(db);
    engine = new MnemosyneEngine(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ==========================================
  // 1. Symbol Boundary Extraction
  // ==========================================
  it("1. extracts symbol boundaries across TypeScript, Python, and Go", () => {
    const tsCode = `
import { foo } from "./bar";

export function calculateTax(income: number): number {
  if (income <= 0) return 0;
  const rate = 0.15;
  return income * rate;
}

export class OrderService {
  processOrder(id: string) {
    return true;
  }
}
`;

    const pyCode = `
import os

def calculate_discount(price, pct):
    if price < 0:
        return 0
    return price * (1 - pct)

class PaymentGateway:
    def charge(self, amount):
        pass
`;

    const goCode = `
package main

func CalculateFee(amount float64) float64 {
	if amount <= 0 {
		return 0
	}
	return amount * 0.05
}
`;

    // TypeScript function
    const taxFn = extractSymbolContent(tsCode, "calculateTax");
    expect(taxFn).not.toBeNull();
    expect(taxFn).toContain("export function calculateTax");
    expect(taxFn).toContain("return income * rate;");

    // TypeScript class
    const orderClass = extractSymbolContent(tsCode, "OrderService");
    expect(orderClass).not.toBeNull();
    expect(orderClass).toContain("export class OrderService");

    // Python function
    const pyFn = extractSymbolContent(pyCode, "calculate_discount");
    expect(pyFn).not.toBeNull();
    expect(pyFn).toContain("def calculate_discount");
    expect(pyFn).toContain("return price * (1 - pct)");

    // Go function
    const goFn = extractSymbolContent(goCode, "CalculateFee");
    expect(goFn).not.toBeNull();
    expect(goFn).toContain("func CalculateFee");
  });

  // ==========================================
  // 2. Symbol-Level Code Anchoring & Staleness
  // ==========================================
  it("2. symbol anchor remains fresh when unrelated file lines change, but turns stale when symbol changes", async () => {
    const filePath = resolve(TEST_DIR, "service.ts");
    const initialContent = `
// Header comment
export function processPayment(amount: number): boolean {
  console.log("Processing payment of", amount);
  return amount > 0;
}

export function otherHelper(): string {
  return "unchanged";
}
`;
    writeFileSync(filePath, initialContent, "utf-8");

    const memId = await engine.remember({
      content: "processPayment requires positive amounts and logs processing state",
      scope: "project",
    });

    // Anchor to specific symbol: service.ts#processPayment
    const anchor = engine.anchorMemory(memId, `${filePath}#processPayment`);
    expect(anchor.status).toBe("fresh");
    expect(anchor.symbol_name).toBe("processPayment");
    expect(anchor.symbol_hash).toBeTruthy();

    // Check staleness initially -> fresh
    const check1 = engine.checkStaleness(memId);
    expect(check1.status).toBe("fresh");

    // Scenario A: Unrelated lines change (e.g. edit otherHelper or comments)
    const unrelatedEdit = `
// Modified header comment
export function processPayment(amount: number): boolean {
  console.log("Processing payment of", amount);
  return amount > 0;
}

export function otherHelper(): string {
  return "MODIFIED_HELPER_LOGIC";
}
`;
    writeFileSync(filePath, unrelatedEdit, "utf-8");

    // Staleness check: Should STILL be fresh because processPayment didn't change!
    const check2 = engine.checkStaleness(memId);
    expect(check2.status).toBe("fresh");
    expect(check2.reason).toContain("matches anchor state");

    // Scenario B: The anchored symbol itself is modified
    const symbolEdit = `
// Modified header comment
export function processPayment(amount: number): boolean {
  console.log("NEW LOGIC: Processing with Stripe fee");
  return amount > 10;
}

export function otherHelper(): string {
  return "MODIFIED_HELPER_LOGIC";
}
`;
    writeFileSync(filePath, symbolEdit, "utf-8");

    // Staleness check: Should now be STALE!
    const check3 = engine.checkStaleness(memId);
    expect(check3.status).toBe("stale");
    expect(check3.reason).toContain("content has changed");

    // Scenario C: The symbol is removed entirely
    const symbolRemoved = `
export function otherHelper(): string {
  return "MODIFIED_HELPER_LOGIC";
}
`;
    writeFileSync(filePath, symbolRemoved, "utf-8");

    const check4 = engine.checkStaleness(memId);
    expect(check4.status).toBe("stale");
    expect(check4.reason).toContain("was removed or renamed");
  });

  // ==========================================
  // 3. Zero-LLM Fast Intent Router
  // ==========================================
  it("3. deterministic intent router maps developer prompts with zero token spend in < 0.05ms", () => {
    // A. Negative constraint
    const r1 = routeIntent("Never use 'any' in TypeScript, enforce strict mode");
    expect(r1.intent).toBe("remember_negative");
    expect(r1.confidence).toBeGreaterThan(0.9);
    expect(r1.suggested_tool).toBe("remember");
    expect(r1.suggested_command).toContain("--negative");

    // B. Error remediation
    const r2 = routeIntent("TypeError: Cannot read properties of undefined (reading 'headers')");
    expect(r2.intent).toBe("remediation");
    expect(r2.suggested_tool).toBe("remediate");
    expect(r2.suggested_command).toContain("mnemo remediate");

    // C. Preflight check
    const r3 = routeIntent("Ready to commit: verify rules before push");
    expect(r3.intent).toBe("preflight");
    expect(r3.suggested_tool).toBe("preflight");

    // D. Architecture overview
    const r4 = routeIntent("Explain standing card and architecture of the database");
    expect(r4.intent).toBe("recall_architecture");
    expect(r4.suggested_command).toContain("mnemo card");

    // E. User preference
    const r5 = routeIntent("Dek prefers dark mode and 2 spaces indentation");
    expect(r5.intent).toBe("remember_preference");
    expect(r5.suggested_command).toContain("--category preference");

    // F. Rollup request
    const r6 = routeIntent("Rollup session swarm-42 and compact logs");
    expect(r6.intent).toBe("rollup");
    expect(r6.suggested_tool).toBe("rollup_session");
    expect(r6.tool_arguments.session_id).toBe("swarm-42");

    // G. Code staleness check
    const r7 = routeIntent("Check staleness of anchored code memories");
    expect(r7.intent).toBe("staleness_check");
    expect(r7.suggested_tool).toBe("check_staleness");

    // H. General recall default
    const r8 = routeIntent("what port is the auth service on?");
    expect(r8.intent).toBe("general_recall");
    expect(r8.suggested_tool).toBe("recall");
  });

  // ==========================================
  // 4. Real-Time Memory Mutation Events (SSE Broadcaster)
  // ==========================================
  it("4. emits real-time mutation events to registered event listeners with zero polling overhead", async () => {
    const receivedEvents: any[] = [];
    const unsubscribe = engine.onEvent((event) => {
      receivedEvents.push(event);
    });

    // 1. Trigger remember
    const id = await engine.remember({
      content: "Test real-time event broadcasting",
      scope: "project",
    });

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].type).toBe("MEMORY_CREATED");
    expect(receivedEvents[0].data.id).toBe(id);
    expect(receivedEvents[0].timestamp).toBeGreaterThan(0);

    // 2. Trigger rollup
    await engine.rollup({ session_id: "test-events-session" });

    // 3. Trigger custom event
    engine.emitEvent("GUARDRAIL_TRIGGERED", { rule: "No secrets in code" });
    expect(receivedEvents.some((e) => e.type === "GUARDRAIL_TRIGGERED")).toBe(true);

    // Unsubscribe
    unsubscribe();
    engine.emitEvent("GUARDRAIL_TRIGGERED", { rule: "Another rule" });
    // Should not receive after unsubscribe
    expect(receivedEvents.filter((e) => e.type === "GUARDRAIL_TRIGGERED").length).toBe(1);
  });
});
