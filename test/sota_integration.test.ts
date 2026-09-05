import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";

describe("Mnemosyne SOTA Expansion: End-to-End REST & Engine Integration Suite", () => {
  let db: Database;
  let engine: MnemosyneEngine;
  let testServer: any;
  let tempVaultDir: string;
  let testPort: number;

  beforeAll(async () => {
    db = new Database(":memory:");
    initSchema(db);
    engine = new MnemosyneEngine(db);

    tempVaultDir = path.join(os.tmpdir(), `mnemo_rest_vault_${Date.now()}`);
    fs.mkdirSync(tempVaultDir, { recursive: true });

    // Seed some test data
    await engine.remember({
      content: "Albatross gateway handles user auth on port 8787",
      category: "architecture",
    });

    testServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);

        // Vault endpoints
        if (req.method === "POST" && url.pathname === "/v1/vault/export") {
          const body = (await req.json().catch(() => ({}))) as any;
          const result = engine.exportVault(body.target_dir);
          return Response.json({ success: true, ...result });
        }
        if (req.method === "POST" && url.pathname === "/v1/vault/sync") {
          const body = (await req.json().catch(() => ({}))) as any;
          const result = await engine.syncVault(body.target_dir);
          return Response.json({ success: true, ...result });
        }

        // Benchmark endpoint
        if (req.method === "GET" && url.pathname === "/v1/benchmark/longmemeval") {
          const report = await engine.runBenchmark();
          return Response.json({ success: true, report });
        }

        // Communities endpoint
        if (req.method === "GET" && url.pathname === "/v1/communities") {
          const communities = engine.getCommunities();
          return Response.json({ success: true, count: communities.length, communities });
        }

        // Context Blocks endpoints
        if (req.method === "GET" && url.pathname === "/v1/blocks") {
          const blocks = engine.listBlocks();
          return Response.json({ success: true, count: blocks.length, blocks });
        }

        if (req.method === "GET" && url.pathname.startsWith("/v1/blocks/")) {
          const name = url.pathname.slice("/v1/blocks/".length);
          const block = engine.getBlock(name);
          if (!block) return Response.json({ success: false, error: "Not found" }, { status: 404 });
          return Response.json({ success: true, block });
        }

        if (req.method === "POST" && url.pathname.startsWith("/v1/blocks/")) {
          const subpath = url.pathname.slice("/v1/blocks/".length);
          const isAppend = subpath.endsWith("/append");
          const name = isAppend ? subpath.slice(0, -"/append".length) : subpath;
          const body = (await req.json()) as any;

          if (isAppend) {
            const block = engine.appendBlock(name, body.text);
            return Response.json({ success: true, block });
          } else {
            const block = engine.setBlock(name, body.content, body.token_limit);
            return Response.json({ success: true, block });
          }
        }

        // SOTA 2026: Episodic Rollup & Auto-Compaction
        if (req.method === "POST" && (url.pathname === "/v1/memory/rollup" || url.pathname === "/v1/rollup")) {
          const body = (await req.json().catch(() => ({}))) as any;
          const result = await engine.rollup(body);
          return Response.json({ success: true, ...result });
        }

        // SOTA 2026: Zero-LLM Fast Intent Router
        if (req.method === "POST" && (url.pathname === "/v1/memory/route" || url.pathname === "/v1/route")) {
          const body = (await req.json().catch(() => ({}))) as any;
          const result = engine.route(body.prompt || body.query || "");
          return Response.json({ success: true, ...result });
        }

        // SOTA 2026: Real-Time SSE Stream
        if (req.method === "GET" && url.pathname === "/v1/events") {
          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`)
              );
              controller.close();
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
        }

        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    testPort = testServer.port;
  });

  afterAll(() => {
    if (testServer) testServer.stop();

    try {
      if (fs.existsSync(tempVaultDir)) {
        fs.rmSync(tempVaultDir, { recursive: true, force: true });
      }
    } catch {}
  });

  test("REST POST /v1/vault/export and /v1/vault/sync", async () => {
    // 1. Export vault
    const expRes = await fetch(`http://127.0.0.1:${testPort}/v1/vault/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_dir: tempVaultDir }),
    });
    expect(expRes.status).toBe(200);
    const expData = (await expRes.json()) as any;
    expect(expData.success).toBe(true);
    expect(expData.total_exported).toBeGreaterThanOrEqual(1);

    // 2. Sync vault
    const syncRes = await fetch(`http://127.0.0.1:${testPort}/v1/vault/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_dir: tempVaultDir }),
    });
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as any;
    expect(syncData.success).toBe(true);
  });

  test("REST GET /v1/benchmark/longmemeval", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/v1/benchmark/longmemeval`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.report.verdict).toBe("PASSED");
    expect(data.report.overall_accuracy).toBeGreaterThanOrEqual(0.85);
  });

  test("REST GET /v1/communities", async () => {
    // Generate communities first
    engine.detectCommunities();

    const res = await fetch(`http://127.0.0.1:${testPort}/v1/communities`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.communities.length).toBeGreaterThanOrEqual(1);
  });

  test("REST Working Memory Blocks lifecycle (/v1/blocks)", async () => {
    // 1. List blocks
    const listRes = await fetch(`http://127.0.0.1:${testPort}/v1/blocks`);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.blocks.length).toBeGreaterThanOrEqual(3);

    // 2. Update active_task block
    const setRes = await fetch(`http://127.0.0.1:${testPort}/v1/blocks/active_task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Executing full SOTA enhancement suite" }),
    });
    expect(setRes.status).toBe(200);
    const setData = (await setRes.json()) as any;
    expect(setData.block.content).toBe("Executing full SOTA enhancement suite");

    // 3. Append to block
    const appRes = await fetch(`http://127.0.0.1:${testPort}/v1/blocks/active_task/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Progress: 100% complete" }),
    });
    expect(appRes.status).toBe(200);
    const appData = (await appRes.json()) as any;
    expect(appData.block.content).toContain("Executing full SOTA enhancement suite");
    expect(appData.block.content).toContain("Progress: 100% complete");

    // 4. Retrieve single block
    const getRes = await fetch(`http://127.0.0.1:${testPort}/v1/blocks/active_task`);
    expect(getRes.status).toBe(200);
    const getData = (await getRes.json()) as any;
    expect(getData.block.name).toBe("active_task");
  });

  test("REST POST /v1/memory/rollup and /v1/memory/route", async () => {
    // 1. Ingest episodic memories
    await engine.remember({
      content: "Switched to Bun HTTP server for zero-overhead streaming",
      source_session: "rest-session-1",
    });
    await engine.remember({
      content: "Never expose private keys in git repository",
      source_session: "rest-session-1",
      is_negative_constraint: true,
    });

    // 2. Rollup endpoint
    const rollRes = await fetch(`http://127.0.0.1:${testPort}/v1/memory/rollup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "rest-session-1" }),
    });
    expect(rollRes.status).toBe(200);
    const rollData = (await rollRes.json()) as any;
    expect(rollData.success).toBe(true);
    expect(rollData.rolled_up_count).toBeGreaterThanOrEqual(2);
    expect(rollData.macro_memory_id).toBeTruthy();

    // 3. Route endpoint
    const routeRes = await fetch(`http://127.0.0.1:${testPort}/v1/memory/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "don't use eval in JavaScript" }),
    });
    expect(routeRes.status).toBe(200);
    const routeData = (await routeRes.json()) as any;
    expect(routeData.success).toBe(true);
    expect(routeData.intent).toBe("remember_negative");
  });

  test("REST GET /v1/events (SSE Stream)", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/v1/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: connected");
  });
});
