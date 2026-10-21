/**
 * End-to-end security tests against the REAL daemon (src/server.ts spawned as a
 * subprocess with a throwaway HOME and DB). Every finding of the feat/deriver
 * security audit has a regression check here.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { securityGate, tokenMatches, requiresAuth, hostOnly } from "../src/auth.ts";

const SERVER = join(import.meta.dir, "..", "src", "server.ts");
const TOKEN = "test-token-" + Math.random().toString(36).slice(2);
let proc: ReturnType<typeof Bun.spawn>;
let home: string;
let port: number;
let base: string;

async function freePort(): Promise<number> {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const p = s.port as number;
  s.stop(true);
  return p;
}

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH || "",
    HOME: home,
    MNEMO_DB_PATH: join(home, "memory.db"),
    MNEMO_PORT: String(port),
    MNEMO_DERIVER: "off",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    ...extra,
  };
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const jsonAuth = { ...auth, "Content-Type": "application/json" };

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "mnemo-sec-"));
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  // cwd = throwaway HOME so default vault/rules paths never land in the repo.
  proc = Bun.spawn(["bun", "run", SERVER], { cwd: home, env: env({ MNEMO_AUTH_TOKEN: TOKEN }), stdout: "pipe", stderr: "pipe" });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("daemon did not start");
});

afterAll(() => {
  proc?.kill();
  rmSync(home, { recursive: true, force: true });
});

describe("auth on every route", () => {
  test("legacy aliases outside /v1 are no longer an auth bypass", async () => {
    for (const [method, path] of [
      ["POST", "/ingest"],
      ["POST", "/recall"],
      ["GET", "/card"],
      ["GET", "/stats"],
      ["POST", "/dream"],
      ["GET", "/events"],
    ]) {
      const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify({ content: "pwned", query: "x" }) : undefined });
      expect(`${method} ${path} -> ${r.status}`).toBe(`${method} ${path} -> 401`);
    }
  });

  test("personal-memory routes all need the token", async () => {
    for (const [method, path] of [
      ["POST", "/v1/messages"],
      ["GET", "/v1/peers"],
      ["GET", "/v1/peers/alice/representation"],
      ["POST", "/v1/peers/alice/ask"],
      ["POST", "/v1/peers/alice/context"],
      ["GET", "/v1/peers/alice/facts"],
      ["GET", "/v1/peers/alice/search?q=x"],
      ["PATCH", "/v1/peers/alice/facts/00000000-0000-0000-0000-000000000000"],
      ["DELETE", "/v1/peers/alice/facts/00000000-0000-0000-0000-000000000000"],
      ["POST", "/v1/peers/alice/card"],
      ["POST", "/v1/peers/alice/reflect"],
      ["POST", "/v1/peers/alice/checkpoint"],
      ["GET", "/v1/deriver/status"],
      ["POST", "/v1/deriver/run"],
      ["POST", "/v1/deriver/requeue"],
      ["GET", "/v1/events"],
      ["GET", "/v1/system/metrics"],
      ["POST", "/v1/vault/export"],
      ["DELETE", "/v1/memory/x"],
      ["GET", "/nope"],
    ]) {
      const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: ["POST", "PATCH"].includes(method) ? "{}" : undefined });
      expect(`${method} ${path} -> ${r.status}`).toBe(`${method} ${path} -> 401`);
    }
  });

  test("a wrong token, a query-string token, and a forged cookie are rejected; the right token works", async () => {
    expect((await fetch(`${base}/v1/peers`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
    expect((await fetch(`${base}/v1/peers?token=${TOKEN}`)).status).toBe(401);
    expect((await fetch(`${base}/v1/peers`, { headers: { Cookie: "mnemo_token=nope" } })).status).toBe(401);
    expect((await fetch(`${base}/v1/peers`, { headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/v1/peers`, { headers: { Cookie: `mnemo_token=${TOKEN}` } })).status).toBe(200);
  });

  test("health and the dashboard shell stay public but leak nothing", async () => {
    const h = await (await fetch(`${base}/health`)).json() as Record<string, unknown>;
    expect(Object.keys(h).sort()).toEqual(["service", "status", "version"]);
    const d = await fetch(`${base}/`);
    expect(d.status).toBe(200);
    expect(await d.text()).not.toContain(TOKEN);
  });
});

describe("browser-borne attacks", () => {
  test("DNS rebinding: an unknown Host header is refused", async () => {
    const r = await fetch(`${base}/v1/peers`, { headers: { ...auth, Host: "evil.example:" + port } });
    expect(r.status).toBe(421);
    const ok = await fetch(`${base}/health`, { headers: { Host: `localhost:${port}` } });
    expect(ok.status).toBe(200);
  });

  test("cross-origin and null origins are refused; loopback origins get CORS", async () => {
    expect((await fetch(`${base}/v1/peers`, { headers: { ...auth, Origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(`${base}/v1/peers`, { headers: { ...auth, Origin: "null" } })).status).toBe(403);
    expect((await fetch(`${base}/v1/peers`, { headers: { ...auth, Origin: "http://127.0.0.1.evil.example" } })).status).toBe(403);
    const ok = await fetch(`${base}/v1/peers`, { headers: { ...auth, Origin: "http://localhost:3000" } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const pre = await fetch(`${base}/v1/messages`, { method: "OPTIONS", headers: { Origin: "http://localhost:3000" } });
    expect(pre.status).toBe(204);
  });

  test("Sec-Fetch-Site: cross-site fetches are refused, a top-level dashboard navigation is allowed", async () => {
    const r = await fetch(`${base}/v1/messages`, { method: "POST", headers: { ...jsonAuth, "Sec-Fetch-Site": "cross-site" }, body: "{}" });
    expect(r.status).toBe(403);
    const nav = await fetch(`${base}/`, { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" } });
    expect(nav.status).toBe(200);
  });

  test("CSRF: form-encodable content types never reach a handler", async () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const r = await fetch(`${base}/v1/messages`, { method: "POST", headers: { ...auth, "Content-Type": ct }, body: JSON.stringify({ peer: "alice", content: "csrf" }) });
      expect(r.status).toBe(415);
    }
  });

  test("dashboard is not frameable and has a CSP that blocks exfiltration targets", async () => {
    const r = await fetch(`${base}/dashboard`);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    const csp = r.headers.get("content-security-policy") || "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const api = await fetch(`${base}/v1/peers`, { headers: auth });
    expect(api.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("filesystem and process boundaries", () => {
  test("vault export/sync refuse arbitrary target_dir (path traversal)", async () => {
    for (const target_dir of ["/tmp/mnemo-pwn", "../../../../etc", join(home, ".ssh")]) {
      const r = await fetch(`${base}/v1/vault/export`, { method: "POST", headers: jsonAuth, body: JSON.stringify({ target_dir }) });
      expect(r.status).toBe(400);
      const s = await fetch(`${base}/v1/vault/sync`, { method: "POST", headers: jsonAuth, body: JSON.stringify({ target_dir }) });
      expect(s.status).toBe(400);
    }
    expect(existsSync("/tmp/mnemo-pwn")).toBe(false);
    const ok = await fetch(`${base}/v1/vault/export`, { method: "POST", headers: jsonAuth, body: "{}" });
    expect(ok.status).toBe(200);
  });

  test("rules sync refuses non-rule files (no appending memory text to ~/.bashrc)", async () => {
    const r = await fetch(`${base}/v1/rules/sync`, { method: "POST", headers: jsonAuth, body: JSON.stringify({ targetPath: join(home, ".bashrc") }) });
    const j = (await r.json()) as any;
    expect(j.success).toBe(false);
    expect(existsSync(join(home, ".bashrc"))).toBe(false);
  });

  test("timer install rejects unit-file injection in decay_days / calendar_schedule", async () => {
    for (const body of [
      { decay_days: "30\nExecStartPre=/bin/sh -c 'touch /tmp/pwned'", enable_and_start: false },
      { calendar_schedule: "daily\n[Service]\nExecStart=/bin/sh", enable_and_start: false },
    ]) {
      const r = await fetch(`${base}/v1/timer/install`, { method: "POST", headers: jsonAuth, body: JSON.stringify(body) });
      expect(((await r.json()) as any).success).toBe(false);
    }
    const unitDir = join(home, ".config", "systemd", "user");
    const units = existsSync(unitDir) ? readdirSync(unitDir) : [];
    for (const u of units) expect(await Bun.file(join(unitDir, u)).text()).not.toContain("ExecStartPre");
  });

  test("SQL metacharacters in search/filter params are inert", async () => {
    await fetch(`${base}/v1/messages`, { method: "POST", headers: jsonAuth, body: JSON.stringify({ peer: "alice", content: "alice likes durian" }) });
    for (const q of ["' OR 1=1 --", "%' UNION SELECT key,value FROM meta --", "\\\"; DROP TABLE messages; --", "%", "_"]) {
      const f = await fetch(`${base}/v1/peers/alice/facts?q=${encodeURIComponent(q)}&category=${encodeURIComponent(q)}&kind=${encodeURIComponent(q)}`, { headers: auth });
      expect(f.status).toBe(200);
      expect(((await f.json()) as any).facts.length).toBe(0);
      const s = await fetch(`${base}/v1/peers/alice/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(q)}`, { headers: auth });
      expect(s.status).toBe(200);
    }
    const st = (await (await fetch(`${base}/v1/deriver/status`, { headers: auth })).json()) as any;
    expect(st.status.queue.pending + st.status.queue.skipped).toBeGreaterThan(0); // messages table intact
  });

  test("peer and fact ids in the path cannot traverse to other peers or routes", async () => {
    for (const p of ["/v1/peers/..%2F..%2Fv1%2Fblocks/facts", "/v1/peers/alice%2F..%2Fbob/facts", "/v1/peers/%00/facts", "/v1/peers/" + "a".repeat(65) + "/facts"]) {
      const r = await fetch(base + p, { headers: auth });
      expect([400, 404]).toContain(r.status);
    }
  });
});

describe("DoS limits", () => {
  test("oversized bodies are refused, including chunked bodies without Content-Length", async () => {
    const big = "x".repeat(6 * 1024 * 1024);
    const r = await fetch(`${base}/v1/messages`, { method: "POST", headers: jsonAuth, body: JSON.stringify({ peer: "a", content: big }) });
    expect(r.status).toBe(413);
    const stream = new ReadableStream({
      start(c) {
        const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
        for (let i = 0; i < 7; i++) c.enqueue(chunk);
        c.close();
      },
    });
    const chunked = await fetch(`${base}/v1/messages`, { method: "POST", headers: jsonAuth, body: stream }).catch(() => null);
    expect(chunked === null || chunked.status === 413 || chunked.status === 400).toBe(true);
    // daemon survives
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  test("hand-written facts and questions have size caps", async () => {
    const c = await fetch(`${base}/v1/peers/alice/conclusions`, { method: "POST", headers: jsonAuth, body: JSON.stringify({ content: "y".repeat(5000) }) });
    expect(c.status).toBe(413);
    const a = await fetch(`${base}/v1/peers/alice/ask`, { method: "POST", headers: jsonAuth, body: JSON.stringify({ question: "q".repeat(5000) }) });
    expect(a.status).toBe(413);
  });
});

describe("bind policy", () => {
  test("refuses to bind a non-loopback address without a token", async () => {
    const p = Bun.spawn(["bun", "run", SERVER], { cwd: home, env: env({ MNEMO_HOST: "0.0.0.0", MNEMO_PORT: String(await freePort()) }), stdout: "pipe", stderr: "pipe" });
    const code = await p.exited;
    expect(code).toBe(1);
    expect(await new Response(p.stderr).text()).toContain("Refusing to bind");
  });
});

describe("gate unit behaviour", () => {
  test("token comparison is exact and constant-time shaped", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abcd", "abc")).toBe(false);
    expect(tokenMatches(null, "abc")).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
  test("only the public shell skips auth", () => {
    for (const p of ["/ingest", "/events", "/card", "/stats", "/recall", "/dream", "/v1/peers"]) expect(requiresAuth(p)).toBe(true);
    for (const p of ["/", "/dashboard", "/health", "/v1/health", "/v1/auth/session"]) expect(requiresAuth(p)).toBe(false);
  });
  test("host parsing handles ports and IPv6", () => {
    expect(hostOnly("127.0.0.1:8788")).toBe("127.0.0.1");
    expect(hostOnly("[::1]:8788")).toBe("[::1]");
    expect(hostOnly("LOCALHOST")).toBe("localhost");
  });
  test("no-token mode still blocks cross-site and rebinding", () => {
    const u = new URL("http://127.0.0.1:8788/v1/peers");
    expect(securityGate(new Request(u.href, { headers: { host: "attacker.test" } }), u)?.status).toBe(421);
    expect(securityGate(new Request(u.href, { headers: { host: "127.0.0.1:8788", origin: "https://attacker.test" } }), u)?.status).toBe(403);
    expect(securityGate(new Request(u.href, { headers: { host: "127.0.0.1:8788" } }), u)).toBeNull();
  });
});
