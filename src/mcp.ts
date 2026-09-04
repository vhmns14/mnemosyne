#!/usr/bin/env bun
import { getDatabase } from "./db/connection.ts";
import { MnemosyneEngine } from "./engine/index.ts";
import type { ContextResolution, MemoryCategory, MemoryImportance, MemoryOutcome, MemoryScope } from "./types.ts";

const db = getDatabase();
const engine = new MnemosyneEngine(db);

const TOOLS = [
  {
    name: "recall_memory",
    description: "Search long-term semantic, episodic, and holographic memory with automatic negative constraint warnings and failure retrospectives.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query or concept to recall." },
        scope: { type: "string", enum: ["global", "project", "session", "all"], description: "Scope filter. Defaults to 'all'." },
        resolution: { type: "string", enum: ["macro", "meso", "micro"], description: "Context detail level. 'macro' is concise gist; 'meso' is bullet points; 'micro' is raw json. Defaults to 'meso'." },
        limit: { type: "number", description: "Maximum number of memories to return (default 5)." },
        max_tokens: { type: "number", description: "Optional token budget limit for context compaction." },
        include_expired: { type: "boolean", description: "Whether to include expired temporal facts (default false)." }
      },
      required: ["query"]
    }
  },
  {
    name: "remember_memory",
    description: "Persist a new fact, rule, preference, or architectural decision with automatic entity triple extraction, conflict resolution, and anti-pattern tagging.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact, rule, or decision to remember." },
        scope: { type: "string", enum: ["global", "project", "session"], description: "Memory scope. Defaults to 'global'." },
        category: { type: "string", enum: ["hardware", "preference", "architecture", "rule", "fact", "episodic", "negative_constraint", "reflection"], description: "Category tag. Defaults to 'fact'." },
        importance: { type: "string", enum: ["low", "normal", "high", "critical"], description: "Importance level. Defaults to 'normal'." },
        is_negative_constraint: { type: "boolean", description: "Set true if this is an anti-pattern or forbidden action." },
        outcome: { type: "string", enum: ["success", "failure", "neutral"], description: "Outcome tag for retrospective learning." },
        failure_reason: { type: "string", description: "If outcome is failure, explain what went wrong." },
        valid_days: { type: "number", description: "Temporal validity window in days (optional)." },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags." },
        supersedes_query: { type: "string", description: "If this overrides an older fact, keywords to invalidate old memory." }
      },
      required: ["content"]
    }
  },
  {
    name: "detect_drift",
    description: "Semantic Drift Radar: checks if a proposed statement or decision conflicts with established architectural baselines or constraints.",
    inputSchema: {
      type: "object",
      properties: {
        statement: { type: "string", description: "The proposed statement, code decision, or preference to verify." },
        threshold: { type: "number", description: "Similarity threshold (default 0.65)." }
      },
      required: ["statement"]
    }
  },
  {
    name: "get_clusters",
    description: "Thematic Knowledge Clustering: clusters active long-term memories into semantic topics using leader clustering.",
    inputSchema: {
      type: "object",
      properties: {
        threshold: { type: "number", description: "Cosine similarity cluster threshold (default 0.55)." }
      }
    }
  },
  {
    name: "export_pack",
    description: "Export portable JSON memory pack with SHA-256 checksum for safe sharing without database files.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Scope to export (default 'all')." }
      }
    }
  },
  {
    name: "import_pack",
    description: "Import portable memory pack into database after verifying cryptographic checksum.",
    inputSchema: {
      type: "object",
      properties: {
        pack_json: { type: "string", description: "Raw JSON string of the MemoryPack." }
      },
      required: ["pack_json"]
    }
  },
  {
    name: "audit_health",
    description: "Context Doctor: audits memory structural integrity, stale links, and orphaned triples.",
    inputSchema: {
      type: "object",
      properties: {
        repair: { type: "boolean", description: "If true, automatically repairs corrupted records." }
      }
    }
  },
  {
    name: "cryptographic_purge",
    description: "EU AI Act Article 13 hard purge: permanently wipes memory and returns a tamper-proof SHA-256 audit receipt.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_query: { type: "string", description: "Memory UUID or query to permanently purge." }
      },
      required: ["id_or_query"]
    }
  },
  {
    name: "add_alias",
    description: "Map an entity alias or abbreviation to its canonical name (e.g. 'gw' -> 'albatross-gateway').",
    inputSchema: {
      type: "object",
      properties: {
        alias: { type: "string", description: "Short alias or colloquial name." },
        canonical_name: { type: "string", description: "Full canonical name." }
      },
      required: ["alias", "canonical_name"]
    }
  },
  {
    name: "consolidate_memories",
    description: "Run background memory consolidation pass: prunes expired temporal facts and strengthens associative links.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_profile",
    description: "Retrieve the synthesized Theory-of-Mind user worldview, hardware constraints, and working preferences.",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: { type: "string", enum: ["user", "agent"], description: "Entity profile to fetch. Defaults to 'user'." }
      }
    }
  },
  {
    name: "find_remedy",
    description: "Look up automated diagnostic root cause and shell/code fix steps for errors or failure symptoms (Reflexion Playbooks).",
    inputSchema: {
      type: "object",
      properties: {
        symptom: { type: "string", description: "The error message, status code, or failure symptom." }
      },
      required: ["symptom"]
    }
  },
  {
    name: "synthesize_reflection",
    description: "Generate high-level thematic abstractions and insights from multiple atomic memories on a topic (Stanford Generative Agents).",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic or theme to reflect on." }
      },
      required: ["topic"]
    }
  },
  {
    name: "forget_memory",
    description: "Mark a memory as inactive or forgotten by UUID or substring match.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_query: { type: "string", description: "Memory UUID or search text to mark inactive." }
      },
      required: ["id_or_query"]
    }
  },
  {
    name: "export_rules",
    description: "Export active operational rules and negative constraints to AGENTS.md, cursorrules, claude.md, or system prompt format.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["agents.md", "cursorrules", "claude.md", "system_prompt"], description: "Export format (default: agents.md)." },
        scope: { type: "string", description: "Scope filter (default: all)." }
      }
    }
  },
  {
    name: "sync_rules",
    description: "Synchronize active operational rules and negative constraints safely into a target file (e.g. AGENTS.md, .cursorrules).",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Target file path (default: AGENTS.md)." },
        format: { type: "string", enum: ["agents.md", "cursorrules", "claude.md", "system_prompt"], description: "Format." },
        scope: { type: "string", description: "Scope filter." }
      }
    }
  },
  {
    name: "get_timeline",
    description: "Retrieve chronological audit trail from the immutable event ledger for a memory or concept.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Memory ID or search term." }
      },
      required: ["target"]
    }
  },
  {
    name: "get_digest",
    description: "Generate a human-readable activity digest and structured changelog of memory activity over the last N hours.",
    inputSchema: {
      type: "object",
      properties: {
        hours: { type: "number", description: "Hours window to inspect (default: 24)." }
      }
    }
  },
  {
    name: "capture_git",
    description: "Automatically inspect the latest git commit in the workspace and capture architectural decisions, rules, or failure lessons.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Workspace directory (default: current directory)." },
        scope: { type: "string", description: "Memory scope (default: project)." }
      }
    }
  },
  {
    name: "capture_error",
    description: "Record an operational troubleshooting error playbook (Reflexion pattern).",
    inputSchema: {
      type: "object",
      properties: {
        trigger_pattern: { type: "string", description: "Error message or regex pattern." },
        problem_summary: { type: "string", description: "Concise summary of the problem." },
        root_cause: { type: "string", description: "Diagnosed root cause." },
        fix_steps: { type: "array", items: { type: "string" }, description: "Ordered shell/code fix steps." },
        scope: { type: "string", description: "Scope (default: global)." }
      },
      required: ["trigger_pattern", "problem_summary", "root_cause", "fix_steps"]
    }
  },
  {
    name: "create_backup",
    description: "Create an atomic, hot online backup snapshot of the SQLite database using native VACUUM INTO.",
    inputSchema: {
      type: "object",
      properties: {
        target_dir: { type: "string", description: "Optional directory for the backup file." }
      }
    }
  },
  {
    name: "list_backups",
    description: "List all existing backup snapshots.",
    inputSchema: {
      type: "object",
      properties: {
      }
    }
  },
  {
    name: "preflight_check",
    description: "Pre-Flight Agent Firewall: Intercepts and validates proposed shell commands or actions against 16GB laptop rules and negative constraints before execution.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The proposed shell command or tool action to validate." },
        context_path: { type: "string", description: "Optional project folder or context path." }
      },
      required: ["command"]
    }
  },
  {
    name: "calibrate_tool",
    description: "Tool Calibration & Execution Trajectory: Retrieve proven past commands and few-shot demonstrations for a specific goal or error recovery.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Goal or failed command to calibrate." },
        tool_name: { type: "string", description: "Tool name (e.g. 'shell', 'git')." }
      },
      required: ["goal"]
    }
  },
  {
    name: "record_trajectory",
    description: "Record an execution trajectory (goal, failed command, error snippet, and working fixed command) for future tool calibration.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Goal or intent of the command." },
        fixed_command: { type: "string", description: "The working command that succeeded." },
        failed_command: { type: "string", description: "Previous command that failed (if applicable)." },
        error_snippet: { type: "string", description: "Error output that was resolved." },
        tool_name: { type: "string", description: "Tool name (default: shell)." }
      },
      required: ["goal", "fixed_command"]
    }
  },
  {
    name: "check_code_staleness",
    description: "Check if memories anchored to codebase files have become stale or unlinked due to Git commits or file edits.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "Specific memory ID to check (optional, checks all if omitted)." }
      }
    }
  },
  {
    name: "blackboard_set",
    description: "Set a key-value fact or status on the shared multi-agent epistemic blackboard.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session or swarm task identifier." },
        key: { type: "string", description: "State key name." },
        value: { description: "State value (object, string, or primitive)." },
        state_type: { type: "string", enum: ["hypothesis", "verified_fact", "in_progress", "artifact", "blocker"], description: "Epistemic state type." }
      },
      required: ["session_id", "key", "value"]
    }
  },
  {
    name: "blackboard_get",
    description: "Retrieve keys or list all state from the shared multi-agent epistemic blackboard.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session or swarm task identifier." },
        key: { type: "string", description: "Specific key to get (if omitted, lists all keys in session)." }
      },
      required: ["session_id"]
    }
  },
  {
    name: "sleep_dreamer_pass",
    description: "Autonomous Sleep & Dreamer Pass: synthesizes thematic abstractions, prunes decayed transient memories, and compacts knowledge graph.",
    inputSchema: {
      type: "object",
      properties: {
        dry_run: { type: "boolean", description: "Set true to simulate without committing changes." }
      }
    }
  },
  {
    name: "install_git_hook",
    description: "Install the Git pre-commit firewall into the repository to strictly block database files (*.db, *.db-wal, *.db-shm) and guardrail violations.",
    inputSchema: {
      type: "object",
      properties: {
        target_dir: { type: "string", description: "Repository directory (default: current working directory)." }
      }
    }
  },
  {
    name: "get_session_primer",
    description: "Generate an authoritative, token-compacted Session Primer markdown briefing containing hardware guardrails, blackboard blockers, stale file alerts, and proven trajectories.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: { type: "string", description: "Workspace directory path." }
      }
    }
  },
  {
    name: "get_standing_card",
    description: "Fast Path: Retrieve 10-20 standing facts (user profile, preferences, hardware invariants) with 0 LLM latency and 0 vector computation.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Scope filter (default: global)." },
        limit: { type: "number", description: "Limit number of facts (default: 15)." }
      }
    }
  },
  {
    name: "upsert_fact",
    description: "Upsert a standing fact with entity + predicate deduplication and self-healing contradiction resolution (prevents duplicate store bloat).",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Entity subject (e.g. 'Dek', 'Server')." },
        predicate: { type: "string", description: "Relation predicate (e.g. 'LIKES', 'USES', 'LISTENS_ON')." },
        object: { type: "string", description: "Target object value (e.g. 'Americano', 'Bun')." },
        scope: { type: "string", description: "Scope (global, project, session)." },
        category: { type: "string", description: "Category (preference, architecture, fact)." }
      },
      required: ["subject", "predicate", "object"]
    }
  },
  {
    name: "delete_by_provenance",
    description: "Bulk delete / purge memories and entity triples by provenance metadata (source_session, peer, or type) for clean rollback.",
    inputSchema: {
      type: "object",
      properties: {
        source_session: { type: "string", description: "Session identifier to purge." },
        peer: { type: "string", description: "Peer name to purge." }
      }
    }
  }
];

function sendJson(msg: any) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleMessage(line: string) {
  if (!line.trim()) return;
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = req;

  if (method === "initialize") {
    sendJson({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mnemosyne-memory", version: "1.1.0" }
      }
    });
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    sendJson({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params || {};

    try {
      if (name === "recall_memory") {
        const res = await engine.recall({
          query: args.query,
          scope: args.scope || "all",
          resolution: (args.resolution as ContextResolution) || "meso",
          limit: args.limit || 5,
          max_tokens: args.max_tokens,
          include_expired: Boolean(args.include_expired),
        });

        sendJson({
          jsonrpc: "2.0",
          id,
          result: { 
            content: [{ type: "text", text: res.formatted }],
            token_budget: res.token_budget 
          }
        });
        return;
      }

      if (name === "remember_memory") {
        let validUntil: number | null = null;
        if (args.valid_days) {
          validUntil = Date.now() + args.valid_days * 24 * 60 * 60 * 1000;
        }

        const memId = await engine.remember({
          content: args.content,
          scope: (args.scope as MemoryScope) || "global",
          category: (args.category as MemoryCategory) || "fact",
          importance: (args.importance as MemoryImportance) || "normal",
          is_negative_constraint: Boolean(args.is_negative_constraint),
          outcome: (args.outcome as MemoryOutcome) || "neutral",
          failure_reason: args.failure_reason,
          valid_until: validUntil,
          tags: args.tags || [],
          supersedes_query: args.supersedes_query
        });

        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `Memory stored successfully (ID: ${memId}).` }] }
        });
        return;
      }

      if (name === "add_alias") {
        engine.addAlias(args.alias, args.canonical_name);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `Alias registered: "${args.alias}" -> "${args.canonical_name}".` }] }
        });
        return;
      }

      if (name === "consolidate_memories") {
        const rep = engine.consolidate();
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(rep, null, 2) }] }
        });
        return;
      }

      if (name === "get_profile") {
        const profile = engine.getPersona((args.entity_type || "user") as any);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] }
        });
        return;
      }

      if (name === "find_remedy") {
        const remedies = engine.getRemedies(args.symptom);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(remedies, null, 2) }] }
        });
        return;
      }

      if (name === "synthesize_reflection") {
        const reflection = engine.reflect(args.topic);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: reflection ? reflection.abstraction : "Not enough data to reflect on." }] }
        });
        return;
      }

      if (name === "forget_memory") {
        const success = engine.forget(args.id_or_query);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: success ? "Memory deactivated." : "No matching memory found." }] }
        });
        return;
      }

      if (name === "detect_drift") {
        const drift = await engine.detectDrift(args.statement, args.threshold);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(drift, null, 2) }] }
        });
        return;
      }

      if (name === "get_clusters") {
        const clusters = engine.getClusters(args.threshold);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(clusters, null, 2) }] }
        });
        return;
      }

      if (name === "export_pack") {
        const pack = engine.exportPack(args.scope || "all");
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(pack, null, 2) }] }
        });
        return;
      }

      if (name === "import_pack") {
        const packData = typeof args.pack_json === "string" ? JSON.parse(args.pack_json) : args.pack_json;
        const result = await engine.importPack(packData);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
        });
        return;
      }

      if (name === "audit_health") {
        const report = engine.doctor(Boolean(args.repair));
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] }
        });
        return;
      }

      if (name === "cryptographic_purge") {
        const receipt = engine.purge(args.id_or_query);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: receipt ? JSON.stringify(receipt, null, 2) : "No matching memory found." }] }
        });
        return;
      }

      if (name === "export_rules") {
        const rules = engine.exportRules(args.format, args.scope);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: rules.content }] }
        });
        return;
      }

      if (name === "sync_rules") {
        const syncRes = engine.syncRules(args.target || "AGENTS.md", args.format, args.scope);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `Successfully synced ${syncRes.ruleCount} rules (${syncRes.negativeCount} negative guardrails) to ${syncRes.filePath}.` }] }
        });
        return;
      }

      if (name === "get_timeline") {
        const events = engine.timeline(args.target);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] }
        });
        return;
      }

      if (name === "get_digest") {
        const digest = engine.getDigest(args.hours || 24);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: digest.markdown_report }] }
        });
        return;
      }

      if (name === "capture_git") {
        const res = await engine.captureGit({ cwd: args.cwd, scope: args.scope });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "capture_error") {
        const res = await engine.captureError({
          triggerPattern: args.trigger_pattern,
          problemSummary: args.problem_summary,
          rootCause: args.root_cause,
          fixSteps: Array.isArray(args.fix_steps) ? args.fix_steps : [args.fix_steps],
          scope: args.scope,
        });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "create_backup") {
        const res = engine.backup(args.target_dir);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "list_backups") {
        const res = engine.listBackups(args.target_dir);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "preflight_check") {
        const res = await engine.preflight(args.command, { contextPath: args.context_path });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "calibrate_tool") {
        const res = engine.calibrateTool(args.goal, { tool_name: args.tool_name });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "record_trajectory") {
        const res = engine.recordTrajectory({
          goal: args.goal,
          fixed_command: args.fixed_command,
          failed_command: args.failed_command,
          error_snippet: args.error_snippet,
          tool_name: args.tool_name,
        });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "check_code_staleness") {
        const res = args.memory_id
          ? engine.checkStaleness(args.memory_id)
          : engine.scanStaleness();
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "blackboard_set") {
        const res = engine.blackboard.set(
          args.session_id,
          args.key,
          args.value,
          {
            stateType: args.state_type || "hypothesis",
            authorAgentId: "mcp-agent",
          }
        );
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "blackboard_get") {
        const res = args.key
          ? engine.blackboard.get(args.session_id, args.key)
          : engine.blackboard.list(args.session_id);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "sleep_dreamer_pass") {
        const res = await engine.dream({ dryRun: Boolean(args.dry_run) });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "install_git_hook") {
        const res = engine.installGitHook(args.target_dir);
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "get_session_primer") {
        const res = engine.prime({ workspacePath: args.workspace_path });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: res.markdown }] }
        });
        return;
      }

      if (name === "get_standing_card") {
        const res = engine.getCard({ scope: args.scope, limit: args.limit });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: res.formatted }] }
        });
        return;
      }

      if (name === "upsert_fact") {
        const res = await engine.upsertFact({
          subject: args.subject,
          predicate: args.predicate,
          object: args.object,
          scope: args.scope,
          category: args.category,
        });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      if (name === "delete_by_provenance") {
        const res = engine.deleteBySource({
          source_session: args.source_session,
          peer: args.peer,
        });
        sendJson({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] }
        });
        return;
      }

      sendJson({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Tool not found: ${name}` }
      });
    } catch (err: any) {
      sendJson({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err.message || "Internal error" }
      });
    }
    return;
  }

  if (id !== undefined) {
    sendJson({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not implemented: ${method}` }
    });
  }
}

const readline = await import("node:readline");
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

rl.on("line", (line) => {
  handleMessage(line).catch((err) => console.error("MCP error:", err));
});
