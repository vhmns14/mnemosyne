import os from "node:os";
import fs from "node:fs";
import { CONFIG } from "./config.ts";
import { getDatabase, closeDatabase } from "./db/connection.ts";
import { MnemosyneEngine } from "./engine/index.ts";
import { getDashboardHtml } from "./dashboard/template.ts";
import type { ContextResolution, MemoryCategory, MemoryImportance, MemoryOutcome, MemoryScope } from "./types.ts";

function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

const db = getDatabase();
const engine = new MnemosyneEngine(db);

let server: any;
try {
  server = Bun.serve({
    port: CONFIG.PORT,
    hostname: CONFIG.HOST,
    async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // Security: Restrict CORS to localhost origins only to prevent browser website exfiltration
    const origin = req.headers.get("origin");
    let allowedOrigin = "*";
    if (origin) {
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (isLocalhost) {
        allowedOrigin = origin;
      } else {
        return new Response("CORS Forbidden: External web domains cannot access local memory daemon.", { status: 403 });
      }
    }

    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Mnemosyne-Key",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Security: Enforce 5MB payload limit to prevent memory exhaustion (RAM 16GB limit)
    if (method === "POST") {
      const cl = req.headers.get("content-length");
      if (cl && parseInt(cl, 10) > 5 * 1024 * 1024) {
        return Response.json(
          { success: false, error: "Payload Too Large: Maximum request body is 5MB." },
          { status: 413, headers: corsHeaders }
        );
      }
    }

    // Security: Optional Bearer/Header token authentication if configured
    const authToken = process.env.MNEMO_AUTH_TOKEN;
    if (authToken && url.pathname.startsWith("/v1/memory")) {
      const authHeader = req.headers.get("authorization") || req.headers.get("x-mnemosyne-key");
      const expectedBearer = `Bearer ${authToken}`;
      if (authHeader !== expectedBearer && authHeader !== authToken) {
        return Response.json(
          { success: false, error: "Unauthorized: Invalid or missing authentication token." },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    // Dashboard HTML UI (zero dependency single-page app)
    if ((method === "GET" || method === "HEAD") && (url.pathname === "/" || url.pathname === "/dashboard")) {
      return new Response(method === "HEAD" ? null : getDashboardHtml(), {
        headers: {
          ...corsHeaders,
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
          version: "1.2.0",
          db_path: CONFIG.DB_PATH,
          weights: CONFIG.WEIGHTS,
        },
        { headers: corsHeaders }
      );
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
        const targetPath = body.targetPath || "AGENTS.md";
        const format = body.format;
        const scope = body.scope || "all";
        const result = engine.syncRules(targetPath, format, scope);
        return Response.json({ success: true, ...result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // Auto-Capture Git
    if (method === "POST" && url.pathname === "/v1/memory/capture/git") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const result = await engine.captureGit({ cwd: body.cwd, scope: body.scope });
        return Response.json({ success: true, result }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
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

    // Anchor Memory to Git
    if (method === "POST" && url.pathname === "/v1/memory/anchor") {
      try {
        const body = (await req.json()) as any;
        if (!body.memory_id || !body.file_path) {
          return Response.json(
            { success: false, error: "Missing required 'memory_id' or 'file_path'" },
            { status: 400, headers: corsHeaders }
          );
        }
        const anchor = engine.anchorMemory(body.memory_id, body.file_path, body.repo_path);
        return Response.json({ success: true, anchor }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
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

    // Autonomous Sleep & Dreamer Pass
    if (method === "POST" && url.pathname === "/v1/memory/dream") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const report = await engine.dream({
          decay_days: body?.decay_days,
          min_cluster_size: body?.min_cluster_size,
          dry_run: body?.dry_run,
        });
        return Response.json({ success: true, report }, { headers: corsHeaders });
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
        const res = engine.installGitHook(body?.target_dir);
        return Response.json({ success: res.success, result: res }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (method === "POST" && url.pathname === "/v1/hooks/uninstall") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const res = engine.uninstallGitHook(body?.target_dir);
        return Response.json({ success: res.success, result: res }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
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

    // Hermes Ingest Protocol (POST /ingest and POST /v1/ingest)
    if (method === "POST" && (url.pathname === "/ingest" || url.pathname === "/v1/ingest")) {
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
          peer: body.peer,
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

    // Hermes Background Dreamer (POST /dream and POST /v1/dream)
    if (method === "POST" && (url.pathname === "/dream" || url.pathname === "/v1/dream")) {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const report = await engine.dreamHermes({
          session_id: body?.session_id,
          batch_size: body?.batch_size,
          force: Boolean(body?.force),
          dry_run: Boolean(body?.dry_run),
        });
        return Response.json({ success: true, dream: report }, { headers: corsHeaders });
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

      return Response.json(
        { error: "Not found", path: url.pathname },
        { status: 404, headers: corsHeaders }
      );
    },
  });

  console.log(`🏛️ Mnemosyne Memory REST Daemon running on http://${server.hostname}:${server.port}`);

  function handleShutdown(signal: string) {
    console.log(`\n🛑 Received ${signal}. Gracefully shutting down Mnemosyne REST Daemon...`);
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
