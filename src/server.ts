import { randomBytes } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import { CONFIG, VERSION } from "./config.ts";
import { securityGate, tokenMatches, sessionCookie, clearSessionCookie, isLoopbackHost } from "./auth.ts";
import { getDatabase, closeDatabase } from "./db/connection.ts";
import { MnemosyneEngine } from "./engine/index.ts";
import { getDashboardHtml } from "./dashboard/template.ts";
import { DeriverWorker } from "./engine/deriver.ts";
import { legacyVectorHint, verifyLegacyVectors } from "./engine/reembed.ts";
import { handlePeerApi } from "./peer/api.ts";
import { resolveVaultDirForApi } from "./engine/vault.ts";
import { assertRuleFilePath } from "./engine/rules_exporter.ts";
import { resolveAnchorForApi, resolveGitDirForApi, resolveWorkspaceDirForApi, isAllowedApiPath, assertApiGitAllowed, assertApiHooksDirAllowed, PathConfinementError } from "./engine/safe_paths.ts";
import { detectWorkspace } from "./engine/workspace.ts";
import { findGitRoot } from "./engine/hook.ts";

const gitRootOf = (d: string): string | null => { const ws = detectWorkspace(d); return ws.is_git ? ws.root_path : findGitRoot(d); };
const errStatus = (err: any): number => (err instanceof PathConfinementError ? 403 : 500);
import type { ContextResolution, MemoryCategory, MemoryImportance, MemoryOutcome, MemoryScope } from "./types.ts";

// Request body shapes for POST routes. JSON bodies are untrusted input; these
// types are the validated-by-guard subset actually read by each route.
interface FeedbackBody { memory_id?: string; verdict?: string; note?: string }
interface PromoteBody { memory_id?: string; to?: MemoryScope }
interface DecideBody { candidate_id?: string; action?: string }
interface ConflictsBody { content?: string; scope?: MemoryScope; category?: MemoryCategory }
interface WhyBody { claim?: string; limit?: number; min_score?: number }

function readBody<T extends object>(req: Request): Promise<T> {
  return req.json().then((json) => json as T).catch(() => ({} as T));
}

function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

const db = getDatabase();
const engine = new MnemosyneEngine(db);

// Background deriver: learns facts from queued conversation messages (no LLM on the request path).
const deriver = new DeriverWorker(db);
if (CONFIG.DERIVER_ENABLED) deriver.start();

// Legacy vectors of unknown model: one-line hint, plus a bounded background
// sample-reembed check that re-tags rows provably produced by the configured model.
{
  const hint = legacyVectorHint(db);
  if (hint) {
    console.warn(hint);
    const limit = parseInt(process.env.MNEMO_LEGACY_VERIFY_LIMIT || "20", 10);
    if (limit > 0) {
      verifyLegacyVectors(db, { limit })
        .then((r) => { if (r.tagged) console.warn(`[mnemo] verified ${r.tagged} legacy vector(s) as ${r.target_model}.`); })
        .catch(() => {});
    }
  }
}

// SOTA 2026: Real-Time Server-Sent Events (SSE) Client Broadcaster
const sseClients = new Set<ReadableStreamDefaultController>();

engine.onEvent((event) => {
  if (sseClients.size === 0) return;
  const encoder = new TextEncoder();
  const raw = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  const bytes = encoder.encode(raw);
  for (const client of sseClients) {
    try {
      client.enqueue(bytes);
    } catch {
      sseClients.delete(client);
    }
  }
});

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const ALLOWED_HOSTS = [
  ...(process.env.MNEMO_ALLOWED_HOSTS || "").split(","),
  ...(CONFIG.HOST && CONFIG.HOST !== "0.0.0.0" && CONFIG.HOST !== "::" ? [CONFIG.HOST] : []),
].map((h) => h.trim().toLowerCase()).filter(Boolean);

// Refuse to expose an unauthenticated memory store beyond this machine.
if (!isLoopbackHost(CONFIG.HOST) && !process.env.MNEMO_AUTH_TOKEN) {
  console.error(`Refusing to bind ${CONFIG.HOST} without MNEMO_AUTH_TOKEN: personal memory would be readable by anyone on the network.`);
  process.exit(1);
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};
// The dashboard has no inline handlers (event delegation) and its one script carries a
// per-response nonce, so scripts need no 'unsafe-inline': an injected <script> or
// on*= attribute never runs. Styles keep 'unsafe-inline' (style attributes; no script
// capability). No third-party origins (fonts are the system stack), no framing.
function dashboardCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function withSecurityHeaders(res: Response): Response {
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
  } catch {
    // immutable headers (e.g. a proxied Response): leave as is
  }
  return res;
}

let server: any;
try {
  server = Bun.serve({
    port: CONFIG.PORT,
    hostname: CONFIG.HOST,
    maxRequestBodySize: MAX_BODY_BYTES,
    // Never Bun's development error page (stack traces, file paths) to a client.
    development: false,
    error(err) {
      console.error(`[mnemo] unhandled request error: ${(err as Error)?.message ?? err}`);
      return withSecurityHeaders(Response.json({ success: false, error: "Internal Server Error" }, { status: 500 }));
    },
    fetch: async (req) => withSecurityHeaders(await (async (): Promise<Response> => {
    const url = new URL(req.url);
    const method = req.method;

    // Security gate: Host allow-list (DNS rebinding), loopback-only Origin, no
    // cross-site fetches, JSON-only state changes (CSRF), and token auth on every
    // non-public route when MNEMO_AUTH_TOKEN is set. Query-string tokens are not
    // accepted (they leak via logs and Referer).
    const authToken = process.env.MNEMO_AUTH_TOKEN || "";
    const origin = req.headers.get("origin");
    const corsHeaders: Record<string, string> = origin
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Mnemosyne-Key",
          Vary: "Origin",
        }
      : {};
    const denied = securityGate(req, url, { token: authToken, allowedHosts: ALLOWED_HOSTS });
    if (denied) {
      for (const [k, v] of Object.entries(corsHeaders)) if (denied.status !== 403) denied.headers.set(k, v);
      return denied;
    }

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Security: 5MB payload limit (Content-Length fast path; Bun.serve's
    // maxRequestBodySize also caps chunked bodies that carry no Content-Length).
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const cl = req.headers.get("content-length");
      if (cl && parseInt(cl, 10) > MAX_BODY_BYTES) {
        return Response.json(
          { success: false, error: "Payload Too Large: Maximum request body is 5MB." },
          { status: 413, headers: corsHeaders }
        );
      }
    }

    // Session handshake: exchange the token for an HttpOnly cookie so the dashboard and
    // header-less clients (EventSource) authenticate without a token in the URL.
    if (method === "POST" && url.pathname === "/v1/auth/session") {
      const raw: unknown = await req.json().catch(() => null);
      const provided = raw && typeof raw === "object" && "token" in raw && typeof raw.token === "string" ? raw.token : "";

      if (!authToken || !tokenMatches(provided, authToken)) {
        return Response.json(
          { success: false, error: "Unauthorized: token does not match this daemon." },
          { status: 401, headers: corsHeaders }
        );
      }
      return Response.json(
        { success: true, service: "mnemosyne-memory", version: VERSION },
        { headers: { ...corsHeaders, "Set-Cookie": sessionCookie(authToken) } }
      );
    }

    if (method === "DELETE" && url.pathname === "/v1/auth/session") {
      return Response.json({ success: true }, { headers: { ...corsHeaders, "Set-Cookie": clearSessionCookie() } });
    }

    // Dashboard HTML UI (zero dependency single-page app)
    if ((method === "GET" || method === "HEAD") && (url.pathname === "/" || url.pathname === "/dashboard")) {
      const nonce = randomBytes(18).toString("base64url");
      return new Response(method === "HEAD" ? null : getDashboardHtml(CONFIG.DB_PATH, nonce), {
        headers: {
          ...corsHeaders,
          ...SECURITY_HEADERS,
          "Content-Security-Policy": dashboardCsp(nonce),
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    // Health check
    if ((method === "GET" || method === "HEAD") && (url.pathname === "/health" || url.pathname === "/v1/health")) {
      if (method === "HEAD") {
        return new Response(null, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return Response.json(
        {
          status: "ok",
          service: "mnemosyne-memory",
          version: VERSION,
        },
        { headers: corsHeaders }
      );
    }

    // Real-Time Server-Sent Events (SSE) Stream
    if (method === "GET" && (url.pathname === "/v1/events" || url.pathname === "/events")) {
      let streamController: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start(controller) {
          streamController = controller;
          sseClients.add(controller);
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now(), service: "mnemosyne-events" })}\n\n`)
          );
        },
        cancel() {
          if (streamController) {
            sseClients.delete(streamController);
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        },
      });
    }

    // Real-Time System Telemetry & Resource Observability (RAM, CPU, Disk, SQLite)
    if ((method === "GET" || method === "HEAD") && (url.pathname === "/v1/system/metrics" || url.pathname === "/v1/telemetry")) {
      if (method === "HEAD") {
        return new Response(null, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const mem = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      const getFileSize = (filePath: string) => {
        try {
          return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
        } catch {
          return 0;
        }
      };

      const dbSize = getFileSize(CONFIG.DB_PATH);
      const walSize = getFileSize(`${CONFIG.DB_PATH}-wal`);
      const shmSize = getFileSize(`${CONFIG.DB_PATH}-shm`);
      const totalStorage = dbSize + walSize + shmSize;

      let pragmaStats: any = {};
      try {
        const pageCount = (db.query("PRAGMA page_count").get() as any)?.page_count || 0;
        const pageSize = (db.query("PRAGMA page_size").get() as any)?.page_size || 4096;
        const freelistCount = (db.query("PRAGMA freelist_count").get() as any)?.freelist_count || 0;
        const journalMode = (db.query("PRAGMA journal_mode").get() as any)?.journal_mode || "wal";
        pragmaStats = { pageCount, pageSize, freelistCount, journalMode };
      } catch {}

      const uptimeSec = Math.floor(process.uptime());
      const hours = Math.floor(uptimeSec / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      const seconds = uptimeSec % 60;
      const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

      let counts: any = {
        active_memories: 0,
        total_memories: 0,
        active_triples: 0,
        vector_embeddings: 0,
        dream_count: 0,
        supersession_count: 0,
        eviction_count: 0,
        notes_count: 0,
        patterns_count: 0,
      };
      try {
        counts.active_memories = (db.query("SELECT COUNT(*) as c FROM memories WHERE is_active = 1").get() as any)?.c || 0;
        counts.total_memories = (db.query("SELECT COUNT(*) as c FROM memories").get() as any)?.c || 0;
        counts.active_triples = (db.query("SELECT COUNT(*) as c FROM entity_triples WHERE is_active = 1").get() as any)?.c || 0;
        counts.vector_embeddings = (db.query("SELECT COUNT(*) as c FROM vector_index").get() as any)?.c || 0;
        counts.dream_count = (db.query("SELECT COUNT(*) as c FROM dreams").get() as any)?.c || 0;
        counts.supersession_count = (db.query("SELECT COUNT(*) as c FROM memories WHERE superseded_by_id IS NOT NULL").get() as any)?.c || 0;
        counts.eviction_count = (db.query("SELECT COUNT(*) as c FROM memories WHERE status = 'expired'").get() as any)?.c || 0;
        counts.notes_count = (db.query("SELECT COUNT(*) as c FROM notes").get() as any)?.c || 0;
        counts.patterns_count = (db.query("SELECT COUNT(*) as c FROM patterns").get() as any)?.c || 0;
      } catch {}

      return Response.json(
        {
          success: true,
          timestamp: Date.now(),
          process: {
            pid: process.pid,
            uptime_seconds: uptimeSec,
            uptime_formatted: uptimeFormatted,
            rss_bytes: mem.rss,
            rss_formatted: formatBytes(mem.rss),
            heap_used_bytes: mem.heapUsed,
            heap_used_formatted: formatBytes(mem.heapUsed),
            heap_total_bytes: mem.heapTotal,
            heap_total_formatted: formatBytes(mem.heapTotal),
            cpu_user_ms: Math.round(process.cpuUsage().user / 1000),
            cpu_system_ms: Math.round(process.cpuUsage().system / 1000),
          },
          host: {
            total_ram_bytes: totalMem,
            total_ram_formatted: formatBytes(totalMem),
            free_ram_bytes: freeMem,
            free_ram_formatted: formatBytes(freeMem),
            used_ram_bytes: usedMem,
            used_ram_formatted: formatBytes(usedMem),
            ram_used_pct: +((usedMem / totalMem) * 100).toFixed(1),
            safeguard_status: freeMem > 2 * 1024 * 1024 * 1024 ? "HEALTHY" : "WARNING_LOW_RAM",
            cpu_count: os.cpus().length,
            load_avg: os.loadavg().map((l) => +l.toFixed(2)),
            platform: process.platform,
            arch: process.arch,
            bun_version: Bun.version,
          },
          storage: {
            db_path: CONFIG.DB_PATH,
            db_bytes: dbSize,
            db_formatted: formatBytes(dbSize),
            wal_bytes: walSize,
            wal_formatted: formatBytes(walSize),
            shm_bytes: shmSize,
            shm_formatted: formatBytes(shmSize),
            total_bytes: totalStorage,
            total_formatted: formatBytes(totalStorage),
            pragma: pragmaStats,
          },
          counts,
        },
        { headers: corsHeaders }
      );
    }

    // Theory of Mind Profile
    if (method === "GET" && url.pathname === "/v1/memory/profile") {
      const type = (url.searchParams.get("entity_type") as any) || "user";
      const profile = engine.getPersona(type);
      return Response.json({ success: true, profile }, { headers: corsHeaders });
    }

    // Knowledge Graph
    if (method === "GET" && url.pathname === "/v1/memory/graph") {
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const graph = engine.getGraph(limit);
      return Response.json({ success: true, graph }, { headers: corsHeaders });
    }

    // Entity Aliases
    if (method === "GET" && url.pathname === "/v1/memory/aliases") {
      const aliases = engine.getAliases();
      return Response.json({ success: true, aliases }, { headers: corsHeaders });
    }

    if (method === "POST" && url.pathname === "/v1/memory/alias") {
      try {
        const body = (await req.json()) as any;
        if (!body.alias || !body.canonical_name) {
          return Response.json(
            { success: false, error: "Missing required 'alias' and 'canonical_name'" },
            { status: 400, headers: corsHeaders }
          );
        }
        engine.addAlias(body.alias, body.canonical_name);
        return Response.json({ success: true, alias: body.alias, canonical: body.canonical_name }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // ---- Session lifecycle (F1) ----
    if (method === "POST" && url.pathname === "/v1/session/start") {
      const body = await req.json().catch(() => ({}));
      const session = engine.startSession(body || {});
      return Response.json({ success: true, session }, { headers: corsHeaders });
    }

    if (method === "POST" && url.pathname === "/v1/session/end") {
      const body = await req.json().catch(() => ({}));
      try {
        const result = await engine.endSession(body || {});
        return Response.json({ success: true, ...result }, { headers: corsHeaders });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unable to end session";
        return Response.json({ success: false, error: message }, { status: 400, headers: corsHeaders });
      }
    }

    if (method === "GET" && url.pathname === "/v1/session/brief") {
      const brief = engine.sessionBrief(url.searchParams.get("workspace") || undefined);
      return Response.json({ success: true, brief }, { headers: corsHeaders });
    }

    if (method === "GET" && (url.pathname === "/v1/sessions" || url.pathname === "/v1/session")) {
      const limit = parseInt(url.searchParams.get("limit") || "10", 10);
      return Response.json(
        { success: true, sessions: engine.sessions(limit), active: engine.activeSession() },
        { headers: corsHeaders }
      );
    }

    // ---- Usage feedback & promotion (F2 / F4) ----
    if (method === "POST" && url.pathname === "/v1/memory/feedback") {
      const body = await readBody<FeedbackBody>(req);
      const verdict = body?.verdict === "misled" ? "misled" : body?.verdict === "helped" ? "helped" : null;
      if (!body?.memory_id || !verdict) {
        return Response.json(
          { success: false, error: "Requires 'memory_id' and 'verdict' ('helped' | 'misled')" },
          { status: 400, headers: corsHeaders }
        );
      }
      const usage = engine.rate(body.memory_id, verdict, body.note);
      return Response.json({ success: Boolean(usage), usage }, { headers: corsHeaders });
    }

    if (method === "GET" && url.pathname === "/v1/memory/promotions") {
      const minProjects = parseInt(url.searchParams.get("min_projects") || "3", 10);
      return Response.json({ success: true, promotions: engine.promotions(minProjects) }, { headers: corsHeaders });
    }

    if (method === "POST" && url.pathname === "/v1/memory/promote") {
      const body = await readBody<PromoteBody>(req);
      if (!body?.memory_id) {
        return Response.json({ success: false, error: "Missing 'memory_id'" }, { status: 400, headers: corsHeaders });
      }
      const promoted = engine.promote(body.memory_id, body.to || "global");
      return Response.json({ success: promoted }, { headers: corsHeaders });
    }

    // ---- Candidate queue (F3) ----
    if (method === "GET" && url.pathname === "/v1/candidates") {
      const status = url.searchParams.get("status") || "pending";
      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      return Response.json({ success: true, candidates: engine.candidates(status, limit) }, { headers: corsHeaders });
    }

    if (method === "POST" && url.pathname === "/v1/candidates/decide") {
      const body = await readBody<DecideBody>(req);
      if (!body?.candidate_id || !body?.action) {
        return Response.json(
          { success: false, error: "Requires 'candidate_id' and 'action' ('approve' | 'reject')" },
          { status: 400, headers: corsHeaders }
        );
      }
      if (body.action === "approve") {
        const memoryId = await engine.promoteCandidate(body.candidate_id);
        return Response.json({ success: Boolean(memoryId), memory_id: memoryId }, { headers: corsHeaders });
      }
      return Response.json({ success: engine.rejectCandidate(body.candidate_id) }, { headers: corsHeaders });
    }

    // ---- Conflict preview & belief explanation (F5 / F6) ----
    if (method === "POST" && url.pathname === "/v1/memory/conflicts") {
      const body = await readBody<ConflictsBody>(req);
      if (!body?.content) {
        return Response.json({ success: false, error: "Missing 'content'" }, { status: 400, headers: corsHeaders });
      }
      const conflicts = await engine.conflicts(body.content, { scope: body.scope, category: body.category });
      return Response.json({ success: true, conflicts }, { headers: corsHeaders });
    }

    if (method === "POST" && url.pathname === "/v1/memory/why") {
      const body = await readBody<WhyBody>(req);
      if (!body?.claim) {
        return Response.json({ success: false, error: "Missing 'claim'" }, { status: 400, headers: corsHeaders });
      }
      const explanation = await engine.why(body.claim, { limit: body.limit, min_score: body.min_score });
      return Response.json({ success: true, explanation }, { headers: corsHeaders });
    }

    // Consolidation pass
    if (method === "POST" && url.pathname === "/v1/memory/consolidate") {
      const report = engine.consolidate();
      return Response.json({ success: true, report }, { headers: corsHeaders });
    }

    // Remember Memory
    if (method === "POST" && url.pathname === "/v1/memory/remember") {
      try {
        const body = (await req.json()) as any;
        if (!body.content || typeof body.content !== "string") {
          return Response.json(
            { success: false, error: "Missing required 'content' string in body" },
            { status: 400, headers: corsHeaders }
          );
        }

        let validUntil: number | null = null;
        if (body.valid_days) {
          validUntil = Date.now() + body.valid_days * 24 * 60 * 60 * 1000;
        } else if (body.valid_until) {
          validUntil = body.valid_until;
        }

        const id = await engine.remember({
          content: body.content,
          scope: (body.scope as MemoryScope) || "global",
          category: (body.category as MemoryCategory) || "fact",
          importance: (body.importance as MemoryImportance) || "normal",
          tags: body.tags || [],
          supersedes_query: body.supersedes_query,
          entities: body.entities,
          is_negative_constraint: Boolean(body.is_negative_constraint),
          outcome: (body.outcome as MemoryOutcome) || "neutral",
          failure_reason: body.failure_reason,
          valid_until: validUntil,
        });

        return Response.json({ success: true, memory_id: id }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json(
          { success: false, error: err.message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Recall Memory
    if (method === "POST" && url.pathname === "/v1/memory/recall") {
      try {
        const body = (await req.json()) as any;
        if (!body.query || typeof body.query !== "string") {
          return Response.json(
            { success: false, error: "Missing required 'query' string in body" },
            { status: 400, headers: corsHeaders }
          );
        }

        const res = await engine.recall({
          query: body.query,
          scope: body.scope || "all",
          resolution: (body.resolution as ContextResolution) || "meso",
          limit: body.limit || 5,
          min_relevance: body.min_relevance || 0.2,
          enable_resonance: body.enable_resonance !== false,
          include_expired: Boolean(body.include_expired),
          max_tokens: body.max_tokens,
        });

        return Response.json(
          {
            success: true,
            count: res.memories.length,
            formatted: res.formatted,
            memories: res.memories,
            token_budget: res.token_budget,
          },
          { headers: corsHeaders }
        );
      } catch (err: any) {
        return Response.json(
          { success: false, error: err.message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Semantic Drift Radar
    if (method === "POST" && url.pathname === "/v1/memory/drift") {
      try {
        const body = (await req.json()) as any;
        if (!body.statement) {
          return Response.json({ success: false, error: "Missing required 'statement'" }, { status: 400, headers: corsHeaders });
        }
        const drift = await engine.detectDrift(body.statement, body.threshold);
        return Response.json({ success: true, drift }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Thematic Clusters
    if (method === "GET" && url.pathname === "/v1/memory/clusters") {
      const threshold = url.searchParams.get("threshold") ? parseFloat(url.searchParams.get("threshold")!) : 0.55;
      const clusters = engine.getClusters(threshold);
      return Response.json({ success: true, clusters }, { headers: corsHeaders });
    }

    // Export Memory Pack
    if (method === "GET" && url.pathname === "/v1/memory/pack/export") {
      const scope = url.searchParams.get("scope") || "all";
      const pack = engine.exportPack(scope);
      return Response.json({ success: true, pack }, { headers: corsHeaders });
    }

    // Import Memory Pack
    if (method === "POST" && url.pathname === "/v1/memory/pack/import") {
      try {
        const body = (await req.json()) as any;
        const pack = body.pack || body;
        const result = await engine.importPack(pack);
        return Response.json({ success: true, result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Forget Memory
    if (method === "DELETE" && url.pathname.startsWith("/v1/memory/")) {
      const idOrQuery = decodeURIComponent(url.pathname.replace("/v1/memory/", "")).trim();
      if (!idOrQuery || idOrQuery.length < 2 || idOrQuery === "%" || idOrQuery === "_") {
        return Response.json(
          { success: false, error: "Bad Request: Target ID or keyword must be at least 2 characters and cannot be a wildcard." },
          { status: 400, headers: corsHeaders }
        );
      }
      const success = engine.forget(idOrQuery);
      return Response.json({ success, id_or_query: idOrQuery }, { headers: corsHeaders });
    }

    // Context Doctor Audit & Repair
    if (method === "GET" && url.pathname === "/v1/doctor/audit") {
      const report = engine.doctor(false);
      return Response.json({ success: true, report }, { headers: corsHeaders });
    }

    if (method === "POST" && url.pathname === "/v1/doctor/repair") {
      const report = engine.doctor(true);
      return Response.json({ success: true, report }, { headers: corsHeaders });
    }

    // Brain Digest / Changelog
    if (method === "GET" && url.pathname === "/v1/digest") {
      const hours = parseInt(url.searchParams.get("hours") || "24", 10);
      const digest = engine.getDigest(hours);
      return Response.json({ success: true, digest }, { headers: corsHeaders });
    }

    // Rules Export
    if (method === "GET" && url.pathname === "/v1/rules/export") {
      const format = (url.searchParams.get("format") as any) || "agents.md";
      const scope = url.searchParams.get("scope") || "all";
      const exported = engine.exportRules(format, scope);
      return Response.json({ success: true, ...exported }, { headers: corsHeaders });
    }

    // Rules Sync
    if (method === "POST" && url.pathname === "/v1/rules/sync") {
      try {
        const body = (await req.json()) as any;
        // Name allow-list, then directory confinement on the realpath (a symlinked
        // AGENTS.md inside a root must not redirect the write outside it), then the
        // name check again on what the path really is.
        const targetPath = assertRuleFilePath(resolveWorkspaceDirForApi(assertRuleFilePath(body.targetPath || "AGENTS.md"), "targetPath"));
        const format = body.format;
        const scope = body.scope || "all";
        const result = engine.syncRules(targetPath, format, scope);
        return Response.json({ success: true, ...result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: errStatus(err), headers: corsHeaders });
      }
    }

    // Auto-Capture Git
    if (method === "POST" && url.pathname === "/v1/memory/capture/git") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const cwd = resolveGitDirForApi(body.cwd, gitRootOf, "cwd");
        assertApiGitAllowed(cwd);
        const result = await engine.captureGit({ cwd, scope: body.scope });
        return Response.json({ success: true, result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: errStatus(err), headers: corsHeaders });
      }
    }

    // Auto-Capture Error Playbook
    if (method === "POST" && url.pathname === "/v1/memory/capture/error") {
      try {
        const body = (await req.json()) as any;
        if (!body.trigger_pattern || !body.problem_summary || !body.root_cause || !body.fix_steps) {
          return Response.json(
            { success: false, error: "Missing required fields: trigger_pattern, problem_summary, root_cause, fix_steps" },
            { status: 400, headers: corsHeaders }
          );
        }
        const result = await engine.captureError({
          triggerPattern: body.trigger_pattern,
          problemSummary: body.problem_summary,
          rootCause: body.root_cause,
          fixSteps: Array.isArray(body.fix_steps) ? body.fix_steps : [body.fix_steps],
          scope: body.scope,
        });
        return Response.json({ success: true, ...result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // List Remediation Playbooks
    if (method === "GET" && url.pathname === "/v1/remediations") {
      const rows = db.query("SELECT * FROM remediations ORDER BY success_count DESC, created_at DESC").all() as any[];
      const playbooks = rows.map((r) => ({
        ...r,
        fix_steps: typeof r.fix_steps === "string" ? JSON.parse(r.fix_steps) : r.fix_steps,
      }));
      return Response.json({ success: true, playbooks }, { headers: corsHeaders });
    }

    // Match Remediation Playbooks against error/symptom
    if (method === "POST" && url.pathname === "/v1/remediations/match") {
      try {
        const body = (await req.json()) as any;
        const query = body.error || body.query || "";
        const matches = engine.getRemedies(query);
        return Response.json({ success: true, matches }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Context Knapsack Compactor & Agent Prompt Simulator
    if (method === "POST" && url.pathname === "/v1/context/compact") {
      try {
        const body = (await req.json()) as any;
        const maxTokens = body.max_tokens || 500;
        const query = body.query || "rules constraints setup guidelines";
        const res = await engine.recall({
          query,
          max_tokens: maxTokens,
          resolution: "meso",
          limit: 15,
        });
        return Response.json(
          {
            success: true,
            token_budget: res.token_budget,
            formatted: res.formatted,
            count: res.memories.length,
          },
          { headers: corsHeaders }
        );
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Memory Timeline / Event Ledger
    if (method === "GET" && url.pathname === "/v1/memory/timeline") {
      const idOrQuery = url.searchParams.get("target")?.trim() || "";
      let events: any[] = [];
      if (!idOrQuery || idOrQuery === "all") {
        const rows = db.query(`
          SELECT e.*, m.content as memory_content 
          FROM memory_events e 
          LEFT JOIN memories m ON e.memory_id = m.id 
          ORDER BY e.timestamp DESC LIMIT 100
        `).all() as any[];
        events = rows;
      } else {
        events = engine.timeline(idOrQuery);
      }
      return Response.json({ success: true, events }, { headers: corsHeaders });
    }

    // Memory Diff (Semantic Time-Travel Diff)
    if (method === "GET" && url.pathname === "/v1/memory/diff") {
      const targetA = url.searchParams.get("target_a")?.trim() || "";
      const targetB = url.searchParams.get("target_b")?.trim() || undefined;
      if (!targetA) {
        return Response.json({ success: false, error: "Missing query parameter 'target_a'" }, { status: 400, headers: corsHeaders });
      }
      try {
        const diff = engine.diff(targetA, targetB);
        return Response.json({ success: true, diff }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    // Episodic Rollup & Auto-Compaction (POST /v1/memory/rollup, POST /v1/rollup)
    if (method === "POST" && (url.pathname === "/v1/memory/rollup" || url.pathname === "/v1/rollup")) {
      try {
        const body = (await req.json().catch(() => ({}))) || {};
        const result = await engine.rollup(body);
        return Response.json({ success: true, ...result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Zero-LLM Fast Intent Router (POST /v1/memory/route, POST /v1/route)
    if (method === "POST" && (url.pathname === "/v1/memory/route" || url.pathname === "/v1/route")) {
      try {
        const body = await readBody<{ prompt?: string; query?: string }>(req);
        const prompt = body.prompt || body.query || "";
        if (!prompt) {
          return Response.json(
            { success: false, error: "Missing required 'prompt' or 'query'" },
            { status: 400, headers: corsHeaders }
          );
        }
        const result = engine.route(prompt);
        return Response.json({ success: true, ...result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Pre-Flight Agent Firewall & Shell Interceptor
    if (method === "POST" && url.pathname === "/v1/preflight/check") {
      try {
        const body = (await req.json()) as any;
        const command = body.command || body.action || "";
        const verdict = await engine.preflight(command, {
          contextPath: body.context_path,
          driftThreshold: body.threshold,
        });
        return Response.json({ success: true, verdict }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Trajectory Recording
    if (method === "POST" && url.pathname === "/v1/trajectory/record") {
      try {
        const body = (await req.json()) as any;
        if (!body.goal || !body.fixed_command) {
          return Response.json(
            { success: false, error: "Missing required 'goal' or 'fixed_command'" },
            { status: 400, headers: corsHeaders }
          );
        }
        const trajectory = engine.recordTrajectory(body);
        return Response.json({ success: true, trajectory }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Tool Calibration Match
    if (method === "POST" && url.pathname === "/v1/trajectory/calibrate") {
      try {
        const body = (await req.json()) as any;
        const query = body.query || body.goal || "";
        const result = engine.calibrateTool(query, {
          tool_name: body.tool_name,
          limit: body.limit,
        });
        return Response.json({ success: true, ...result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // List Trajectories
    if (method === "GET" && url.pathname === "/v1/trajectory/list") {
      const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : 50;
      const trajectories = engine.listTrajectories(limit);
      return Response.json({ success: true, count: trajectories.length, trajectories }, { headers: corsHeaders });
    }

    // Anchor Memory to Git (Supports symbol-level granularity)
    if (method === "POST" && url.pathname === "/v1/memory/anchor") {
      try {
        const body = (await req.json()) as any;
        if (!body.memory_id || !body.file_path) {
          return Response.json(
            { success: false, error: "Missing required 'memory_id' or 'file_path'" },
            { status: 400, headers: corsHeaders }
          );
        }
        const safe = resolveAnchorForApi(body.repo_path, body.file_path);
        const anchor = engine.anchorMemory(body.memory_id, safe.filePath, safe.repoPath, body.symbol_name, { allowGitDir: isAllowedApiPath });
        return Response.json({ success: true, anchor }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: errStatus(err), headers: corsHeaders });
      }
    }

    // Check Staleness
    if (method === "GET" && url.pathname === "/v1/memory/staleness") {
      const memoryId = url.searchParams.get("memory_id");
      if (memoryId) {
        const report = engine.checkStaleness(memoryId);
        return Response.json({ success: true, ...report }, { headers: corsHeaders });
      }
      const scan = engine.scanStaleness();
      return Response.json({ success: true, scan }, { headers: corsHeaders });
    }

    // Unified Autonomous Sleep & Dreamer Pass (POST /v1/memory/dream, POST /v1/dream, POST /dream)
    if (method === "POST" && (url.pathname === "/v1/memory/dream" || url.pathname === "/v1/dream" || url.pathname === "/dream")) {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const report = await engine.dream({
          session_id: body?.session_id,
          batch_size: body?.batch_size,
          decay_days: body?.decay_days ? parseInt(body.decay_days, 10) : undefined,
          min_cluster_size: body?.min_cluster_size ? parseInt(body.min_cluster_size, 10) : undefined,
          dry_run: Boolean(body?.dry_run),
          use_llm: body?.use_llm !== undefined ? Boolean(body.use_llm) : (body?.llm !== undefined ? Boolean(body.llm) : undefined),
          force: Boolean(body?.force),
          reset_watermark: Boolean(body?.reset_watermark),
          from_id: body?.from_id ? parseInt(body.from_id, 10) : undefined,
          rewind: body?.rewind ? parseInt(body.rewind, 10) : undefined,
          pass: body?.pass,
        });
        return Response.json({ success: true, report, dream: report.hermes }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Multi-Agent Epistemic Blackboard Routes
    if (method === "GET" && url.pathname === "/v1/blackboard") {
      const sessionId = url.searchParams.get("session_id") || "default";
      const key = url.searchParams.get("key");
      if (key) {
        const entry = engine.blackboard.get(sessionId, key);
        return Response.json({ success: true, entry }, { headers: corsHeaders });
      }
      const entries = engine.blackboard.list(sessionId);
      return Response.json({ success: true, count: entries.length, entries }, { headers: corsHeaders });
    }

    if (method === "POST" && url.pathname === "/v1/blackboard") {
      try {
        const body = (await req.json()) as any;
        if (!body.key || body.value === undefined) {
          return Response.json(
            { success: false, error: "Missing required 'key' or 'value'" },
            { status: 400, headers: corsHeaders }
          );
        }
        const sessionId = body.session_id || "default";
        const entry = engine.blackboard.set(sessionId, body.key, body.value, {
          stateType: body.state_type,
          authorAgentId: body.author_agent_id,
        });
        return Response.json({ success: true, entry }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (method === "DELETE" && url.pathname === "/v1/blackboard") {
      const sessionId = url.searchParams.get("session_id") || "default";
      const key = url.searchParams.get("key");
      if (key) {
        const deleted = engine.blackboard.delete(sessionId, key);
        return Response.json({ success: true, deleted }, { headers: corsHeaders });
      }
      const cleared = engine.blackboard.clear(sessionId);
      return Response.json({ success: true, cleared }, { headers: corsHeaders });
    }

    // L1 Hot Cache Telemetry
    if (method === "GET" && url.pathname === "/v1/cache/stats") {
      const stats = engine.getCacheStats();
      return Response.json({ success: true, stats }, { headers: corsHeaders });
    }

    // Git Pre-Commit Hook Management
    if (method === "POST" && url.pathname === "/v1/hooks/install") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const res = engine.installGitHook(((d) => (assertApiHooksDirAllowed(d), d))(resolveGitDirForApi(body?.target_dir, gitRootOf, "target_dir")));
        return Response.json({ success: res.success, result: res }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: errStatus(err), headers: corsHeaders });
      }
    }

    if (method === "POST" && url.pathname === "/v1/hooks/uninstall") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const res = engine.uninstallGitHook(((d) => (assertApiHooksDirAllowed(d), d))(resolveGitDirForApi(body?.target_dir, gitRootOf, "target_dir")));
        return Response.json({ success: res.success, result: res }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: errStatus(err), headers: corsHeaders });
      }
    }

    // Dreamer Systemd Timer Management
    if (method === "POST" && url.pathname === "/v1/timer/install") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const res = engine.installDreamerTimer({
          calendarSchedule: body?.calendar_schedule,
          decayDays: body?.decay_days,
          enableAndStart: body?.enable_and_start !== false,
        });
        return Response.json({ success: res.success, result: res }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (method === "GET" && url.pathname === "/v1/timer/status") {
      const status = engine.getDreamerTimerStatus();
      return Response.json({ success: true, status }, { headers: corsHeaders });
    }

    // Agent Session Primer
    if (method === "GET" && url.pathname === "/v1/context/prime") {
      const workspace = url.searchParams.get("workspace") || undefined;
      const primer = engine.prime({ workspacePath: workspace });
      return Response.json({ success: true, primer }, { headers: corsHeaders });
    }

    // Hermes Stats Monitor (GET /stats and GET /v1/stats)
    if (method === "GET" && (url.pathname === "/stats" || url.pathname === "/v1/stats")) {
      const stats = engine.getStats();
      return Response.json({ success: true, stats }, { headers: corsHeaders });
    }

    // Fast Path: Standing Facts Card (Honcho-style)
    if (method === "GET" && (url.pathname === "/card" || url.pathname === "/v1/card")) {
      const scope = url.searchParams.get("scope") || "global";
      const limit = parseInt(url.searchParams.get("limit") || "15", 10);
      const peer = url.searchParams.get("peer") || undefined;
      const card = engine.getCard({ scope, limit, peer });
      return Response.json({ success: true, card }, { headers: corsHeaders });
    }

    // Hermes Ingest Protocol (POST /ingest, POST /v1/ingest, and POST /v1/memory/ingest)
    if (method === "POST" && (url.pathname === "/ingest" || url.pathname === "/v1/ingest" || url.pathname === "/v1/memory/ingest")) {
      try {
        const body = (await req.json()) as any;
        if (!body.content && !body.fact && !body.text) {
          return Response.json(
            { success: false, error: "Missing required 'content', 'fact', or 'text'" },
            { status: 400, headers: corsHeaders }
          );
        }
        const result = await engine.ingest({
          peer: body.peer || "user",
          session_id: body.session_id,
          role: body.role || "user",
          content: (body.content || body.fact || body.text).trim(),
          type: body.type,
          confidence: body.confidence,
          ttl_ms: body.ttl_ms,
          category: body.category,
          is_fact: body.is_fact,
        });
        return Response.json({ success: true, result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Hermes Recall Protocol (POST /recall and POST /v1/recall)
    if (method === "POST" && (url.pathname === "/recall" || url.pathname === "/v1/recall")) {
      try {
        const body = (await req.json()) as any;
        if (!body.query) {
          return Response.json(
            { success: false, error: "Missing required 'query'" },
            { status: 400, headers: corsHeaders }
          );
        }
        const recallRes = await engine.recall({
          query: body.query,
          scope: body.scope,
          max_tokens: body.max_tokens || 350,
          limit: body.limit || 10,
          prefer_bm25: body.prefer_bm25 !== false,
        });
        return Response.json(
          {
            success: true,
            query: body.query,
            facts: recallRes.memories,
            formatted: recallRes.formatted,
            token_count: recallRes.token_budget?.estimated_tokens || Math.ceil(recallRes.formatted.length / 4),
          },
          { headers: corsHeaders }
        );
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Hermes Delete Fact by ID (DELETE /facts/:id and DELETE /v1/facts/:id)
    const factIdMatch = url.pathname.match(/^\/(?:v1\/)?facts\/([^/]+)$/);
    if (method === "DELETE" && factIdMatch) {
      const id = factIdMatch[1];
      const deleted = engine.deleteFact(id);
      return Response.json(
        { success: deleted, message: deleted ? "Fact deleted" : "Fact not found", id },
        { headers: corsHeaders }
      );
    }

    // Upsert Fact (Dedup by Entity + Predicate & Self-Healing Conflict)
    if (method === "POST" && url.pathname === "/v1/fact/upsert") {
      try {
        const body = (await req.json()) as any;
        if (!body.subject || !body.predicate || !body.object) {
          return Response.json(
            { success: false, error: "Missing required 'subject', 'predicate', or 'object'" },
            { status: 400, headers: corsHeaders }
          );
        }
        const result = await engine.upsertFact(body);
        return Response.json({ success: true, result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Extract Facts and Upsert
    if (method === "POST" && url.pathname === "/v1/fact/extract") {
      try {
        const body = (await req.json()) as any;
        if (!body.text) {
          return Response.json(
            { success: false, error: "Missing required 'text'" },
            { status: 400, headers: corsHeaders }
          );
        }
        const results = await engine.extractAndUpsert(body.text, body);
        return Response.json({ success: true, count: results.length, results }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Provenance / PII Delete (Delete by Source)
    if (method === "DELETE" && url.pathname === "/v1/provenance") {
      const source_session = url.searchParams.get("source_session") || undefined;
      const peer = url.searchParams.get("peer") || undefined;
      const memory_type = (url.searchParams.get("memory_type") as any) || undefined;
      const category = (url.searchParams.get("category") as any) || undefined;

      const result = engine.deleteBySource({ source_session, peer, memory_type, category });
      return Response.json({ success: true, result }, { headers: corsHeaders });
    }

    // Fase 10: Markdown Vault Export & Sync
    if (method === "POST" && url.pathname === "/v1/vault/export") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const result = engine.exportVault(resolveVaultDirForApi(body.target_dir));
        return Response.json({ success: true, ...result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    if (method === "POST" && url.pathname === "/v1/vault/sync") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const result = await engine.syncVault(resolveVaultDirForApi(body.target_dir));
        return Response.json({ success: true, ...result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    // Fase 11: LongMemEval Benchmark
    if (method === "GET" && url.pathname === "/v1/benchmark/longmemeval") {
      try {
        const report = await engine.runBenchmark();
        return Response.json({ success: true, report }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Fase 12: Hierarchical Community Summaries
    if (method === "GET" && url.pathname === "/v1/communities") {
      const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 20;
      const communities = engine.getCommunities(limit);
      return Response.json({ success: true, count: communities.length, communities }, { headers: corsHeaders });
    }

    // Fase 13: Dynamic Context Blocks
    if (method === "GET" && url.pathname === "/v1/blocks") {
      const blocks = engine.listBlocks();
      return Response.json({ success: true, count: blocks.length, blocks }, { headers: corsHeaders });
    }

    if (method === "GET" && url.pathname.startsWith("/v1/blocks/")) {
      const name = url.pathname.slice("/v1/blocks/".length);
      const block = engine.getBlock(name);
      if (!block) {
        return Response.json({ success: false, error: "Block not found" }, { status: 404, headers: corsHeaders });
      }
      return Response.json({ success: true, block }, { headers: corsHeaders });
    }

    if (method === "POST" && url.pathname.startsWith("/v1/blocks/")) {
      try {
        const subpath = url.pathname.slice("/v1/blocks/".length);
        const isAppend = subpath.endsWith("/append");
        const name = isAppend ? subpath.slice(0, -"/append".length) : subpath;
        
        let body: any;
        try {
          body = await req.json();
        } catch {
          return Response.json({ success: false, error: "Malformed or missing JSON body" }, { status: 400, headers: corsHeaders });
        }

        if (isAppend) {
          if (!body || typeof body.text !== "string") {
            return Response.json({ success: false, error: "Missing or invalid 'text' field" }, { status: 400, headers: corsHeaders });
          }
          const block = engine.appendBlock(name, body.text);
          return Response.json({ success: true, block }, { headers: corsHeaders });
        } else {
          if (!body || typeof body.content !== "string") {
            return Response.json({ success: false, error: "Missing or invalid 'content' field" }, { status: 400, headers: corsHeaders });
          }
          const block = engine.setBlock(name, body.content, body.token_limit);
          return Response.json({ success: true, block }, { headers: corsHeaders });
        }
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    if (method === "DELETE" && url.pathname.startsWith("/v1/blocks/")) {
      try {
        const name = url.pathname.slice("/v1/blocks/".length);
        const deleted = engine.deleteBlock(name);
        return Response.json({ success: deleted }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: corsHeaders });
      }
    }

    // Personal memory layer: /v1/messages, /v1/peers/*, /v1/deriver/*
    const peerRes = await handlePeerApi(req, url, { db, worker: deriver }, corsHeaders);
    if (peerRes) return peerRes;

    return Response.json(
      { error: "Not found", path: url.pathname },
      { status: 404, headers: corsHeaders }
    );

    })()),
  });

  console.log(`🏛️ Mnemosyne Memory REST Daemon running on http://${server.hostname}:${server.port}`);

  function handleShutdown(signal: string) {
    console.log(`\n🛑 Received ${signal}. Gracefully shutting down Mnemosyne REST Daemon...`);
    deriver.stop();
    if (server) {
      try {
        server.stop();
      } catch {
        // ignore
      }
    }
    closeDatabase();
    console.log("✔ SQLite WAL checkpointed and closed cleanly. Daemon exited.");
    process.exit(0);
  }

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
} catch (err: any) {
  if (err?.code === "EADDRINUSE" || err?.message?.includes("EADDRINUSE")) {
    console.error(`⚠️ Port ${CONFIG.PORT} is already in use (e.g. systemd mnemosyne.service or existing daemon).`);
    process.exit(1);
  }
  throw err;
}
