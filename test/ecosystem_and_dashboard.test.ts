import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { getDashboardHtml } from "../src/dashboard/template.ts";
import { formatRules, syncRulesToFile, MARKER_START, MARKER_END } from "../src/engine/rules_exporter.ts";
import { captureErrorPlaybook } from "../src/engine/capture.ts";
import { generateBrainDigest } from "../src/engine/digest.ts";
import { getEmbedding, generateLocalEmbedding } from "../src/engine/embedder.ts";
import { CONFIG } from "../src/config.ts";
import { unlinkSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Mnemosyne Ecosystem, Web Dashboard, Auto-Capture & Digest Suite", () => {
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

  it("Rules Exporter & Sync: formats rules for AGENTS.md, cursorrules, and syncs with markers", async () => {
    // 1. Ingest negative constraint & rule
    await engine.remember({
      content: "Never execute heavy builds in background (RAM 16GB limit)",
      category: "hardware",
      importance: "critical",
      is_negative_constraint: true,
    });

    await engine.remember({
      content: "Always use Bun runtime for fastest test execution",
      category: "rule",
      importance: "high",
    });

    // 2. Export rules
    const agentsRules = engine.exportRules("agents.md");
    expect(agentsRules.ruleCount).toBe(2);
    expect(agentsRules.negativeCount).toBe(1);
    expect(agentsRules.content).toContain("# Mnemosyne Operational Rules & Guardrails");
    expect(agentsRules.content).toContain("CRITICAL");
    expect(agentsRules.content).toContain("RAM 16GB limit");
    expect(agentsRules.content).toContain("Always use Bun runtime");

    const cursorRules = engine.exportRules("cursorrules");
    expect(cursorRules.content).toContain("STRICT RESTRICTIONS (DO NOT DO):");
    expect(cursorRules.content).toContain("NEVER Never execute heavy builds");

    // 3. Sync to temporary file
    const tempFile = join(tmpdir(), `test-rules-${Date.now()}.md`);
    writeFileSync(tempFile, "# Custom Project Header\n\nCustom developer notes.\n");

    const syncRes = syncRulesToFile(db, tempFile, "agents.md");
    expect(syncRes.updatedExisting).toBe(true);
    expect(syncRes.ruleCount).toBe(2);

    const updatedContent = readFileSync(tempFile, "utf-8");
    expect(updatedContent).toContain("# Custom Project Header");
    expect(updatedContent).toContain(MARKER_START);
    expect(updatedContent).toContain("RAM 16GB limit");
    expect(updatedContent).toContain(MARKER_END);

    // Update again and ensure markers are replaced, not duplicated
    syncRulesToFile(db, tempFile, "agents.md");
    const twiceUpdated = readFileSync(tempFile, "utf-8");
    const markerMatches = twiceUpdated.match(new RegExp(MARKER_START, "g")) || [];
    expect(markerMatches.length).toBe(1);

    if (existsSync(tempFile)) unlinkSync(tempFile);
  });

  it("Auto-Capture: records Reflexion troubleshooting playbook and links to recall", async () => {
    const result = await captureErrorPlaybook(db, {
      triggerPattern: "albatross gateway timeout 504",
      problemSummary: "Albatross Gateway 504 Timeout",
      rootCause: "Backend upstream server unreachable under high load",
      fixSteps: [
        "curl -s http://localhost:8787/health",
        "systemctl --user restart albatross-service",
      ],
      scope: "global",
    });

    expect(result.playbookId).toBeTruthy();
    expect(result.memoryId).toBeTruthy();

    // Verify recall finds this playbook
    const recallRes = await engine.recall({
      query: "Facing error: albatross gateway timeout 504 in production",
    });

    expect(recallRes.remediations?.length).toBeGreaterThan(0);
    expect(recallRes.remediations![0].root_cause).toContain("Backend upstream server unreachable");
    expect(recallRes.formatted).toContain("albatross-service");
  });

  it("Brain Digest & Changelog: accurately calculates 24h event statistics and markdown report", async () => {
    // Perform memory actions
    await engine.remember({
      content: "Do not run playwright screenshots in parallel",
      category: "negative_constraint",
      is_negative_constraint: true,
      importance: "critical",
    });

    await engine.remember({
      content: "Use SQLite WAL mode for fast concurrency",
      category: "architecture",
      importance: "high",
    });

    // Create a supersession event
    await engine.remember({
      content: "Legacy build command: npm run build",
      category: "fact",
    });
    await engine.remember({
      content: "Modern build command: bun run build",
      category: "fact",
      supersedes_query: "Legacy build command",
    });

    const digest = generateBrainDigest(db, 24);
    expect(digest.timeframe_hours).toBe(24);
    expect(digest.stats.total_events).toBeGreaterThanOrEqual(4);
    expect(digest.stats.created).toBeGreaterThanOrEqual(3);
    expect(digest.new_guardrails.length).toBeGreaterThan(0);
    expect(digest.new_guardrails[0]).toContain("playwright screenshots");
    expect(digest.markdown_report).toContain("Activity Overview");
    expect(digest.markdown_report).toContain("Critical Guardrails Absorbed");
  });

  it("Pluggable Embedder: dispatches gracefully and safely falls back on offline providers", async () => {
    // 1. Local embedder returns valid 384-d vector
    const localVec = generateLocalEmbedding("testing local embedder", 384);
    expect(localVec.length).toBe(384);

    // 2. Configure a fake unreachable Ollama host
    const originalProvider = CONFIG.EMBEDDING_PROVIDER;
    const originalHost = CONFIG.OLLAMA_HOST;

    try {
      CONFIG.EMBEDDING_PROVIDER = "ollama";
      CONFIG.OLLAMA_HOST = "http://127.0.0.1:59999"; // Non-existent port

      // Should not throw or crash; must fall back to local embedder
      const fallbackVec = await getEmbedding("query to unreachable provider");
      expect(fallbackVec.length).toBe(384);
    } finally {
      CONFIG.EMBEDDING_PROVIDER = originalProvider;
      CONFIG.OLLAMA_HOST = originalHost;
    }
  });

  it("Web Dashboard: template renders complete UI with dark theme, canvas, and doctor tabs", () => {
    const html = getDashboardHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Mnemosyne Second Memory");
    expect(html).toContain("graph-canvas");
    expect(html).toContain("Context Doctor");
    expect(html).toContain("Active Negative Constraints");
    expect(html).toContain("/v1/doctor/repair");
    expect(html).toContain("/v1/rules/sync");
  });

  it("REST Daemon: exposes /dashboard, /v1/digest, /v1/doctor/audit, and /v1/rules endpoints", async () => {
    const testPort = 8795;
    const testServer = Bun.serve({
      port: testPort,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
          return new Response(getDashboardHtml(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        if (req.method === "GET" && url.pathname === "/v1/doctor/audit") {
          return Response.json({ success: true, report: engine.doctor(false) });
        }
        if (req.method === "POST" && url.pathname === "/v1/doctor/repair") {
          return Response.json({ success: true, report: engine.doctor(true) });
        }
        if (req.method === "GET" && url.pathname === "/v1/digest") {
          return Response.json({ success: true, digest: engine.getDigest(24) });
        }
        if (req.method === "GET" && url.pathname === "/v1/rules/export") {
          return Response.json({ success: true, ...engine.exportRules("agents.md") });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });

    try {
      // 1. Test Dashboard HTML
      const dashRes = await fetch(`http://127.0.0.1:${testPort}/dashboard`);
      expect(dashRes.status).toBe(200);
      expect(dashRes.headers.get("content-type")).toContain("text/html");
      const html = await dashRes.text();
      expect(html).toContain("Mnemosyne Brain Dashboard");

      // 2. Test Doctor Audit
      const docRes = await fetch(`http://127.0.0.1:${testPort}/v1/doctor/audit`);
      expect(docRes.status).toBe(200);
      const docData = (await docRes.json()) as any;
      expect(docData.success).toBe(true);
      expect(docData.report).toBeDefined();

      // 3. Test 24h Digest
      const digRes = await fetch(`http://127.0.0.1:${testPort}/v1/digest`);
      expect(digRes.status).toBe(200);
      const digData = (await digRes.json()) as any;
      expect(digData.success).toBe(true);
      expect(digData.digest.timeframe_hours).toBe(24);

      // 4. Test Rules Export
      const rulesRes = await fetch(`http://127.0.0.1:${testPort}/v1/rules/export`);
      expect(rulesRes.status).toBe(200);
      const rulesData = (await rulesRes.json()) as any;
      expect(rulesData.success).toBe(true);
      expect(rulesData.content).toBeDefined();
    } finally {
      testServer.stop();
    }
  });
});
