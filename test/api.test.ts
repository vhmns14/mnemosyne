import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";

describe("Mnemosyne Local REST API Endpoints", () => {
  let server: any;
  let testDb: Database;
  let engine: MnemosyneEngine;
  const TEST_PORT = 8799;

  beforeAll(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
    engine = new MnemosyneEngine(testDb);

    server = Bun.serve({
      port: TEST_PORT,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "GET" && url.pathname === "/v1/health") {
          return Response.json({ status: "ok", service: "mnemosyne-memory" });
        }

        if (req.method === "POST" && url.pathname === "/v1/memory/remember") {
          const body = (await req.json()) as any;
          const id = await engine.remember({
            content: body.content,
            category: body.category || "fact",
          });
          return Response.json({ success: true, memory_id: id });
        }

        if (req.method === "POST" && url.pathname === "/v1/memory/recall") {
          const body = (await req.json()) as any;
          const res = await engine.recall({ query: body.query });
          return Response.json({ success: true, count: res.memories.length, formatted: res.formatted });
        }

        if (req.method === "GET" && url.pathname === "/v1/memory/profile") {
          const profile = engine.getPersona("user");
          return Response.json({ success: true, profile });
        }

        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
  });

  afterAll(() => {
    server.stop();
  });

  test("GET /v1/health returns ok", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("ok");
    expect(data.service).toBe("mnemosyne-memory");
  });

  test("POST /v1/memory/remember stores and POST /v1/memory/recall retrieves", async () => {
    const postRes = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/memory/remember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "REST API Daemon is lightweight and sub-5ms" }),
    });
    expect(postRes.status).toBe(200);
    const postData = (await postRes.json()) as any;
    expect(postData.memory_id).toBeDefined();

    const recallRes = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/memory/recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "REST API Daemon" }),
    });
    expect(recallRes.status).toBe(200);
    const recallData = (await recallRes.json()) as any;
    expect(recallData.count).toBeGreaterThan(0);
    expect(recallData.formatted).toContain("REST API Daemon");
  });

  test("GET /v1/memory/profile returns user persona constraints", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/memory/profile`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.profile.hard_constraints).toBeDefined();
    expect(data.profile.hard_constraints.length).toBeGreaterThan(0);
  });
});
