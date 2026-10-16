import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { extractTriples } from "../src/engine/dialectic.ts";
import { getDashboardHtml } from "../src/dashboard/template.ts";
import { VERSION } from "../src/config.ts";

interface DashboardElement {
  innerHTML: string;
  innerText: string;
  value: string;
  className: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  classList: { add(): void; remove(): void };
  appendChild(): void;
  getAttribute(): string | null;
}

interface DashboardBuilder {
  escapeAttr(value: unknown): string;
  renderGuardrailsTable(negatives: unknown[], rules: unknown[]): void;
  renderExplorerTable(negatives: unknown[], rules: unknown[]): void;
  renderPlaybooks(list: unknown[]): void;
  apiFetch(url: string, opts?: RequestInit): Promise<{ status: number }>;
}

const XSS_PAYLOAD = '<img src=x onerror=alert(1)>';

/**
 * Runs the dashboard's own <script> body against a stub DOM, so assertions cover the
 * code the browser actually executes (no duplicated render logic in the test).
 */
function buildDashboard(elements: Map<string, DashboardElement>, fetchImpl: typeof fetch) {
  const html = getDashboardHtml();
  const body = html
    .slice(html.indexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"))
    // Strip the trailing auto-bootstrap (loadStats/initGraph/setInterval) so the
    // builders can be exercised in isolation.
    .split("window.addEventListener('resize'")[0];

  const makeElement = (): DashboardElement => ({
    innerHTML: "",
    innerText: "",
    value: "",
    className: "",
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    appendChild() {},
    getAttribute: () => null,
  });

  const documentStub = {
    getElementById(id: string): DashboardElement {
      let el = elements.get(id);
      if (!el) {
        el = makeElement();
        elements.set(id, el);
      }
      return el;
    },
    createElement: makeElement,
    querySelectorAll: () => [] as DashboardElement[],
    addEventListener() {},
  };

  const factory = new Function(
    "document",
    "window",
    "fetch",
    "navigator",
    "performance",
    "setTimeout",
    "setInterval",
    "confirm",
    `${body}\nreturn { escapeAttr, renderGuardrailsTable, renderExplorerTable, renderPlaybooks, apiFetch };`
  ) as (...args: unknown[]) => DashboardBuilder; // new Function() has no expressible signature

  return factory(documentStub, { addEventListener() {}, removeEventListener() {} }, fetchImpl, {}, {
    now: () => 0,
  }, setTimeout, setInterval, () => true);
}

describe("Audit Part 1: Multi-Value Facts, XSS Sinks, Triple Extraction, Auth, Version, Note Failures", () => {
  test("1. Multi-valued facts coexist while single-valued facts still supersede on change", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const engine = new MnemosyneEngine(db);

    const spicy = await engine.remember({ content: "Dek likes spicy food", category: "preference" });
    const coffee = await engine.remember({ content: "Dek likes coffee", category: "preference" });

    expect(coffee).not.toBe(spicy);

    const rows = db
      .query("SELECT id, is_active, status FROM memories WHERE id IN (?, ?)")
      .all(spicy, coffee) as Array<{ id: string; is_active: number; status: string }>;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.is_active).toBe(1);
      expect(row.status).toBe("active");
    }

    const likedObjects = (
      db.query("SELECT object FROM entity_triples WHERE predicate = 'LIKES' AND is_active = 1").all() as Array<{
        object: string;
      }>
    ).map((t) => t.object.toLowerCase());
    expect(likedObjects).toContain("spicy food");
    expect(likedObjects).toContain("coffee");

    const recalled = await engine.recall({ query: "likes", limit: 5 });
    const recalledIds = recalled.memories.map((m) => m.id);
    expect(recalledIds).toContain(spicy);
    expect(recalledIds).toContain(coffee);

    // Control: LISTENS_ON_PORT is single-valued, so the old binding must be invalidated.
    const portOld = await engine.remember({ content: "Albatross listens on 8787", category: "architecture" });
    const portNew = await engine.remember({ content: "Albatross listens on 9999", category: "architecture" });
    const oldRow = db.query("SELECT is_active, superseded_by_id FROM memories WHERE id = ?").get(portOld) as {
      is_active: number;
      superseded_by_id: string | null;
    };
    expect(oldRow.is_active).toBe(0);
    expect(oldRow.superseded_by_id).toBe(portNew);

    db.close();
  });

  test("2. extractTriples splits a multi-fact sentence instead of swallowing it into one object", () => {
    const triples = extractTriples("Dek likes pizza and Dek deploys via Vercel and Dek requires 16GB RAM");

    expect(triples.length).toBe(3);
    expect(triples.map((t) => t.predicate)).toEqual(["LIKES", "DEPLOYS_VIA", "REQUIRES"]);
    expect(triples.map((t) => t.object)).toEqual(["pizza", "Vercel", "16GB RAM"]);
    for (const t of triples) {
      expect(t.object.toLowerCase()).not.toContain(" and ");
      expect(t.subject).toBe("Dek");
    }
  });

  test("3. Dashboard escapes stored payloads and reveals the auth gate on 401", async () => {
    const elements = new Map<string, DashboardElement>();
    const api = buildDashboard(elements, (async () => ({ status: 401 })) as unknown as typeof fetch);

    api.renderGuardrailsTable(
      [{ content: XSS_PAYLOAD, category: XSS_PAYLOAD, scope: "global", importance: "critical", is_negative_constraint: 1 }],
      []
    );
    api.renderExplorerTable([{ id: XSS_PAYLOAD, content: XSS_PAYLOAD, category: "fact", scope: "global" }], []);
    api.renderPlaybooks([{ id: "p1", symptom_pattern: XSS_PAYLOAD, root_cause: XSS_PAYLOAD, scope: "global", fix_steps: [] }]);

    for (const id of ["guardrails-tbody", "explorer-tbody", "remediations-container"]) {
      const rendered = elements.get(id)?.innerHTML ?? "";
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered).not.toContain(XSS_PAYLOAD);
      expect(rendered).not.toContain("<img");
      expect(rendered).toContain("&lt;img");
    }

    // Ids must travel through data-* attributes, never inside inline JS literals.
    expect(elements.get("explorer-tbody")?.innerHTML).toContain("data-id=");

    await api.apiFetch("/v1/memory/graph");
    expect(elements.get("auth-gate")?.style.display).toBe("flex");
  });

  test("4. Note-log write failures are reported instead of silently killing the dreamer delta", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.exec("DROP TABLE notes;");
    const engine = new MnemosyneEngine(db);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: Parameters<typeof console.warn>) => {
      warnings.push(args.map(String).join(" "));
    };

    let memoryId = "";
    try {
      memoryId = await engine.remember({ content: "Dek likes bakso", category: "preference" });
    } finally {
      console.warn = originalWarn;
    }

    expect(typeof memoryId).toBe("string");
    const stored = db.query("SELECT COUNT(*) as c FROM memories WHERE is_active = 1").get() as { c: number };
    expect(stored.c).toBe(1);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("note log append failed");

    db.close();
  });
});

const REST_PORT = 8877;
const REST_TOKEN = "qa-part1-secret-token";
const REST_DB = "/tmp/mnemo_qa_part1_rest.db";
const MCP_DB = "/tmp/mnemo_qa_part1_mcp.db";

/**
 * Waits for the daemon's startup banner on stdout — the real readiness signal.
 * If the port is taken the process exits instead, ending the stream, so there is
 * no timing guess and no sleep.
 */
async function waitForReady(proc: Subprocess<"pipe", "pipe">, needle: string): Promise<boolean> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return false;
    buffered += decoder.decode(value, { stream: true });
    if (buffered.includes(needle)) return true;
  }
}

describe("Audit Part 1: REST daemon auth, single version source, MCP handshake", () => {
  let server: Subprocess<"pipe", "pipe">;
  let ready = false;

  beforeAll(async () => {
    server = Bun.spawn(["bun", "src/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MNEMO_PORT: String(REST_PORT),
        MNEMO_HOST: "127.0.0.1",
        MNEMO_DB_PATH: REST_DB,
        MNEMO_AUTH_TOKEN: REST_TOKEN,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    ready = await waitForReady(server, "running on http://");
  });

  afterAll(() => {
    server?.kill();
    for (const base of [REST_DB, MCP_DB]) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          rmSync(`${base}${suffix}`, { force: true });
        } catch {
          // nothing to remove
        }
      }
    }
  });

  test("5. Query-string tokens are rejected; cookie sessions authenticate; /health reports the package version", async () => {
    expect(ready).toBe(true);
    const base = `http://127.0.0.1:${REST_PORT}`;

    // Public routes stay reachable without a token.
    const health = await fetch(`${base}/v1/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { version?: string; status?: string };
    expect(healthBody.version).toBe(VERSION);
    expect(healthBody.status).toBe("ok");
    expect((await fetch(`${base}/dashboard`)).status).toBe(200);

    // Protected route: no credentials -> 401, and the old ?token= shortcut no longer works.
    expect((await fetch(`${base}/v1/memory/profile`)).status).toBe(401);
    expect((await fetch(`${base}/v1/memory/profile?token=${REST_TOKEN}`)).status).toBe(401);

    // Header credentials still work.
    const headerRes = await fetch(`${base}/v1/memory/profile`, {
      headers: { Authorization: `Bearer ${REST_TOKEN}` },
    });
    expect(headerRes.status).toBe(200);

    // Wrong token cannot mint a session.
    const badSession = await fetch(`${base}/v1/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "nope" }),
    });
    expect(badSession.status).toBe(401);

    // Correct token mints an HttpOnly session cookie, which then authenticates requests.
    const session = await fetch(`${base}/v1/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: REST_TOKEN }),
    });
    expect(session.status).toBe(200);
    const setCookie = session.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("mnemo_token=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");

    const cookieRes = await fetch(`${base}/v1/memory/profile`, {
      headers: { Cookie: setCookie.split(";")[0] },
    });
    expect(cookieRes.status).toBe(200);
  });

  test("6. MCP initialize handshake reports the same version as package.json", async () => {
    const proc = Bun.spawn(["bun", "src/mcp.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, MNEMO_DB_PATH: MCP_DB },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "qa", version: "1" } },
      }) + "\n"
    );
    await proc.stdin.end();

    const stdout = await new Response(proc.stdout).text();
    proc.kill();

    const initLine = stdout.split("\n").find((line) => line.includes('"initialize"') || line.includes("serverInfo"));
    expect(initLine).toBeDefined();
    const parsed = JSON.parse(initLine ?? "{}") as { result?: { serverInfo?: { version?: string } } };
    expect(parsed.result?.serverInfo?.version).toBe(VERSION);
  });
});
