import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { initSchema } from "../src/db/schema.ts";
import { DeriverWorker } from "../src/engine/deriver.ts";
import { LlmClient } from "../src/engine/llm.ts";
import { addDerivedFact } from "../src/engine/facts.ts";
import { handlePeerApi } from "../src/peer/api.ts";
import { PEER_MCP_TOOLS, callPeerTool } from "../src/peer/mcp_tools.ts";
import { getDashboardHtml } from "../src/dashboard/template.ts";
import { PEER_SCRIPT } from "../src/dashboard/peer_views.ts";
import { MockOpenAI, parseTranscript, idsIn } from "./helpers/mock_openai.ts";

let mock: MockOpenAI;
let db: Database;
let worker: DeriverWorker;
let server: ReturnType<typeof Bun.serve>;
let base: string;

const llmFactory = () => new LlmClient({ url: mock.baseUrl, apiKey: "sk-test-NEVER-SHOW-0000000000", model: "mock-model", backoffMs: 1 });

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any, text: "" };
}

beforeAll(() => {
  mock = new MockOpenAI();
  db = new Database(":memory:");
  initSchema(db);
  worker = new DeriverWorker(db, llmFactory, 60000);
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => (await handlePeerApi(req, new URL(req.url), { db, worker, llm: llmFactory })) ?? new Response("nf", { status: 404 }),
  });
  base = `http://127.0.0.1:${server.port}`;
  mock.handlers.extract = (c) => ({
    facts: parseTranscript(c.user)
      .filter((m) => /prefer|live/.test(m.text))
      .map((m) => ({ content: `carol ${m.text.replace(/^I /, "")}`, kind: "explicit", category: /prefer/.test(m.text) ? "preferences" : "profile", confidence: 0.9, source_message_ids: [m.id] })),
    session_summaries: { web: "Carol shared preferences." },
  });
  mock.handlers.summary = () => ({ summary: "Carol prefers dark mode and lives in Bandung." });
  mock.handlers.ask = (c) => ({ answer: "Carol prefers dark mode.", citations: idsIn(c.user).slice(0, 1), abstain: false });
});

afterAll(() => {
  worker.stop();
  server.stop(true);
  mock.stop();
});

describe("REST: personal memory routes", () => {
  test("POST /v1/messages ingests; deriver run learns; representation, facts, provenance", async () => {
    const ing = await call("POST", "/v1/messages", {
      messages: [
        { peer: "carol", session: "web", role: "user", content: "I prefer dark mode in every editor", ts: 1 },
        { peer: "carol", session: "web", role: "user", content: "I live in Bandung", ts: 2 },
      ],
    });
    expect(ing.status).toBe(200);
    expect(ing.json.ingested).toBe(2);
    expect((await call("POST", "/v1/messages", { peer: "carol", content: 5 })).status).toBe(400);

    const run = await call("POST", "/v1/deriver/run");
    expect(run.json.result.batches[0].added).toBe(2);

    const rep = await call("GET", "/v1/peers/carol/representation");
    expect(rep.json.representation.summary).toContain("dark mode");
    expect(rep.json.representation.card.length).toBe(2);

    const facts = await call("GET", "/v1/peers/carol/facts?category=preferences");
    expect(facts.json.facts.length).toBe(1);
    const fid = facts.json.facts[0].id;
    expect(facts.json.facts[0].trust).toBe(0.5);

    const detail = await call("GET", `/v1/peers/carol/facts/${fid}`);
    expect(detail.json.fact.source_messages[0].content).toContain("dark mode");

    const peers = await call("GET", "/v1/peers");
    expect(peers.json.peers.find((p: any) => p.peer === "carol").facts).toBe(2);
  });

  test("ask with citations, search tiers, fenced context", async () => {
    const ask = await call("POST", "/v1/peers/carol/ask", { question: "Does carol prefer dark mode?" });
    expect(ask.json.abstained).toBe(false);
    expect(ask.json.citations.length).toBe(1);
    expect((await call("POST", "/v1/peers/carol/ask", {})).status).toBe(400);

    const l0 = await call("GET", "/v1/peers/carol/search?q=dark%20mode&tier=L0");
    expect(l0.json.tier).toBe("L0");
    expect(l0.json.items[0].category).toBe("preferences");
    const l2 = await call("GET", "/v1/peers/carol/search?q=dark%20mode&tier=L2");
    expect(l2.json.items[0].provenance.length).toBe(1);

    const ctx = await call("POST", "/v1/peers/carol/context", { query: "editor theme", session: "web", tokens: 500 });
    expect(ctx.json.text).toContain("<mnemo-memory>");
    expect(ctx.json.base.session_summary).toContain("Carol");
  });

  test("correct (PATCH), feedback, conclusions, card pin, delete (purge)", async () => {
    const facts = (await call("GET", "/v1/peers/carol/facts?q=Bandung")).json.facts;
    const id = facts[0].id;

    const patched = await call("PATCH", `/v1/peers/carol/facts/${id}`, { content: "carol lives in Bandung, West Java", category: "profile" });
    expect(patched.status).toBe(200);
    expect(patched.json.replaced).toBe(id);
    const newId = patched.json.fact.id;
    expect(patched.json.fact.kind).toBe("manual");
    expect(patched.json.fact.trust).toBeGreaterThanOrEqual(0.8);
    const old = await call("GET", `/v1/peers/carol/facts/${id}`);
    expect(old.json.fact.is_active).toBe(false);
    expect(old.json.fact.superseded_by_id).toBe(newId);
    const hist = await call("GET", `/v1/peers/carol/facts/${newId}`);
    expect(hist.json.fact.history[0].id).toBe(id);

    const fb = await call("POST", `/v1/peers/carol/facts/${newId}/feedback`, { verdict: "unhelpful" });
    expect(fb.json.trust).toBeCloseTo(0.8 - 0.1, 5);
    expect((await call("POST", `/v1/peers/carol/facts/${newId}/feedback`, { verdict: "meh" })).status).toBe(400);

    const concl = await call("POST", "/v1/peers/carol/conclusions", { content: "carol is a morning person", category: "profile" });
    expect(concl.json.fact.kind).toBe("conclusion");

    const pin = await call("POST", "/v1/peers/carol/card", { card: ["Name: Carol", "Prefers dark mode"] });
    expect(pin.json.representation.pinned).toBe(true);
    expect(pin.json.representation.card).toEqual(["Name: Carol", "Prefers dark mode"]);
    expect((await call("POST", "/v1/peers/carol/card", { card: null })).json.representation.pinned).toBe(false);

    const del = await call("DELETE", `/v1/peers/carol/facts/${concl.json.id}`);
    expect(del.json.receipt).toBeTruthy();
    expect(db.query("SELECT COUNT(*) AS c FROM memories WHERE id = ?").get(concl.json.id)).toEqual({ c: 0 });
    expect(db.query("SELECT COUNT(*) AS c FROM derived_facts WHERE memory_id = ?").get(concl.json.id)).toEqual({ c: 0 });
    expect((await call("GET", `/v1/peers/carol/facts/${concl.json.id}`)).status).toBe(404);
    // A fact cannot be addressed through another peer.
    expect((await call("GET", `/v1/peers/dave/facts/${newId}`)).status).toBe(404);
  });

  test("checkpoint idempotency, deriver status never exposes the key, invalid peer rejected", async () => {
    const msgs = [{ role: "user", content: "I prefer tabs over spaces" }];
    const a = await call("POST", "/v1/peers/carol/checkpoint", { session: "web", messages: msgs });
    const b = await call("POST", "/v1/peers/carol/checkpoint", { session: "web", messages: msgs });
    expect(a.json.duplicate).toBe(false);
    expect(b.json.duplicate).toBe(true);

    const st = await call("GET", "/v1/deriver/status");
    expect(st.json.status.llm.model).toBe("mock-model");
    expect(st.json.status.llm.url).toContain("/v1/chat/completions");
    expect(JSON.stringify(st.json)).not.toContain("NEVER-SHOW");
    expect(typeof st.json.status.queue.pending).toBe("number");

    expect((await call("GET", "/v1/peers/bad%20peer/facts")).status).toBe(400);
  });
});

describe("MCP tools", () => {
  test("ingest_messages, ask_about_user (cited + abstain), get_user_representation", async () => {
    const mdb = new Database(":memory:");
    initSchema(mdb);
    expect(PEER_MCP_TOOLS.map((t) => t.name)).toEqual(["ingest_messages", "ask_about_user", "get_user_representation"]);
    const ing = await callPeerTool(mdb, "ingest_messages", { messages: [{ content: "I prefer green tea" }] }, llmFactory);
    expect(ing!.content[0].text).toContain("Queued 1");
    const empty: any = await callPeerTool(mdb, "ask_about_user", { question: "favourite tea?" }, llmFactory);
    expect(empty.structuredContent.abstained).toBe(true);
    const f = await addDerivedFact(mdb, { peer: "user", content: "user prefers green tea", category: "preferences" });
    const ans: any = await callPeerTool(mdb, "ask_about_user", { question: "what tea does the user prefer? green tea" }, llmFactory);
    expect(ans.structuredContent.citations[0].id).toBe(f.id);
    const rep: any = await callPeerTool(mdb, "get_user_representation", {}, llmFactory);
    expect(rep.structuredContent.card).toContain("user prefers green tea");
    expect(await callPeerTool(mdb, "nope", {}, llmFactory)).toBeNull();
  });
});

describe("Dashboard", () => {
  test("ships Profile/Facts/Ask/Deriver views, escapes the db path, and renders API data without innerHTML", () => {
    const html = getDashboardHtml('/tmp/<img src=x onerror=alert(1)>.db');
    for (const id of ["view-pm-profile", "view-pm-facts", "view-pm-ask", "view-pm-deriver"]) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain("<img src=x onerror");
    expect(PEER_SCRIPT).not.toContain("innerHTML");
    expect(PEER_SCRIPT).not.toContain("insertAdjacentHTML");
    expect(PEER_SCRIPT).toContain("textContent");
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
    expect(() => new Function(script)).not.toThrow();
  });
});

describe("Daemon integration (spawned src/server.ts)", () => {
  const PORT = 18000 + Math.floor(Math.random() * 1000);
  const DB = join(tmpdir(), `mnemo-peer-${process.pid}-${Date.now()}.db`);
  const TOKEN = "peer-test-token";
  let proc: Subprocess<"ignore", "pipe", "pipe">;

  afterAll(() => {
    proc?.kill();
    for (const s of ["", "-wal", "-shm"]) rmSync(DB + s, { force: true });
  });

  test("auth, dashboard, background deriver learns from POST /v1/messages, status hides key", async () => {
    proc = Bun.spawn(["bun", "src/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MNEMO_PORT: String(PORT),
        MNEMO_HOST: "127.0.0.1",
        MNEMO_DB_PATH: DB,
        MNEMO_AUTH_TOKEN: TOKEN,
        MNEMO_LLM_URL: mock.baseUrl,
        MNEMO_LLM_KEY: "sk-daemon-SECRET-1234567890",
        MNEMO_LLM_MODEL: "mock-model",
        MNEMO_DERIVER_INTERVAL_MS: "200",
        MNEMO_LLM_RPM: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const url = `http://127.0.0.1:${PORT}`;
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        up = (await fetch(`${url}/health`)).ok;
      } catch {
        await Bun.sleep(100);
      }
    }
    expect(up).toBe(true);
    const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

    expect((await fetch(`${url}/dashboard`)).status).toBe(200);
    expect((await fetch(`${url}/v1/deriver/status`)).status).toBe(401);
    expect((await fetch(`${url}/v1/peers/carol/facts`)).status).toBe(401);

    const ing = await fetch(`${url}/v1/messages`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ peer: "carol", session: "web", role: "user", content: "I prefer light roast coffee" }),
    });
    expect(ing.status).toBe(200);

    let facts: any[] = [];
    for (let i = 0; i < 50 && facts.length === 0; i++) {
      await Bun.sleep(100);
      facts = ((await (await fetch(`${url}/v1/peers/carol/facts`, { headers: auth })).json()) as any).facts;
    }
    expect(facts.length).toBe(1);
    expect(facts[0].content).toContain("light roast");

    const status = await (await fetch(`${url}/v1/deriver/status`, { headers: auth })).text();
    expect(status).toContain("mock-model");
    expect(status).not.toContain("SECRET");
    expect(JSON.parse(status).status.enabled).toBe(true);

    const pre = await fetch(`${url}/v1/peers/carol/facts/${facts[0].id}`, { method: "OPTIONS", headers: { Origin: "http://localhost:8788" } });
    expect(pre.headers.get("access-control-allow-methods")).toContain("PATCH");
  }, 20000);
});
