import { parseArgs } from "node:util";
import { getDatabase } from "./db/connection.ts";
import { MnemosyneEngine } from "./engine/index.ts";
import type { ContextResolution, MemoryCategory, MemoryImportance, MemoryOutcome, MemoryScope } from "./types.ts";

const db = getDatabase();
const engine = new MnemosyneEngine(db);

const HELP = `
🏛️ Mnemosyne Memory CLI (mnemo)
Universal Long-Term Holographic & Dialectic Memory Engine for AI Agents

USAGE:
  mnemo <command> [arguments] [options]

COMMANDS:
  remember <content>    Store a new memory (auto-detects negative rules & failures)
  recall <query>        Hybrid search (vector + BM25 + recency + resonance + guardrails)
  inject <query>        Output pure context string for piping into LLM / Hermes CLI
  export [file.json]    Export portable JSON memory pack with SHA-256 checksum
  import <file.json>    Import portable memory pack into database
  topics / clusters     List thematic knowledge clusters (online leader clustering)
  drift <statement>     Semantic Drift Radar: test if statement diverges from baseline
  workspace             Detect current project workspace and Git context
  alias <alias> <name>  Map entity alias to canonical name (e.g. mnemo alias gw albatross)
  aliases               List all canonical entity aliases
  consolidate           Run memory consolidation & temporal pruning pass
  remedy <error>        Look up automated troubleshooting playbook (Reflexion)
  reflect <topic>       Synthesize higher-order thematic reflection (Generative Agents)
  reflections           List all synthesized thematic reflections
  doctor [--repair]     Context Doctor: Audit structural integrity and fix anomalies
  purge <id_or_query>   Hard cryptographic deletion with SHA-256 tamper-proof receipt
  timeline <id_or_tag>  Audit trail immutable event ledger for memory mutations
  profile               Display Theory-of-Mind user worldview & constraints
  graph                 Inspect knowledge triples & associative memory graph
  rules [export|sync]   Export or sync active guardrails to AGENTS.md / .cursorrules
  capture git           Auto-capture recent Git commit into project memory
  capture error         Record an error troubleshooting playbook (Reflexion)
  digest [--hours 24]   Print 24-hour brain activity digest & changelog
  dashboard / ui        Display local web dashboard status & URL (port 8788)
  mcp install [client]  Configure MCP in opencode, claude, or cursor
  mcp status            Check MCP configuration status
  service install       Setup systemd user background service
  service [start|stop]  Control systemd daemon (start, stop, restart, status)
  backup [create]       Create atomic online SQLite snapshot (VACUUM INTO)
  backup list           List available backup snapshots
  backup restore <file> Restore database from a snapshot
  card [peer]           Print standing card facts (fast path, zero LLM cost)
  ingest <content>      Ingest message or fact with fast-path fingerprint dedup
  dream [--dry-run]     Run autonomous delta reflection & sleep consolidation
  stats                 Print Hermes memory stats (counts, top entities, patterns)
  preflight <cmd>       Evaluate shell command against RAM & negative constraints
  upsert <s> <p> <o>    Upsert semantic triple with automatic conflict resolution
  delete-source <sess>  Purge all memories and triples originating from a session
  forget <id_or_query>  Mark memory as inactive / forgotten
  help                  Show this help message

OPTIONS:
  -s, --scope <scope>         Scope: global | project | session (default: global for remember, all for recall)
  -c, --category <category>   Category: hardware | preference | architecture | rule | fact | negative_constraint
  -i, --importance <level>    Importance: low | normal | high | critical
  -t, --tag <tag>             Add tag (can specify multiple)
  -r, --resolution <res>      Resolution: macro | meso | micro (default: meso)
  -l, --limit <n>             Maximum results to return (default: 5)
  --tokens <n>                Knapsack token budget packing limit (e.g. --tokens 500)
  -o, --output <file>         Output file for pack export
  --format <format>           Format: agents.md | cursorrules | claude.md | system_prompt
  --target <file>             Target path for syncing rules (default: AGENTS.md)
  --hours <n>                 Hours window for digest (default: 24)
  --trigger <str>             Trigger pattern for error playbook
  --cause <str>               Root cause description for error playbook
  --fix <step>                Fix step command for error playbook (multiple allowed)
  --threshold <n>             Similarity threshold for clustering/drift (default: 0.55-0.65)
  --negative                  Force flag as strict Negative Constraint / Anti-pattern
  --failure <reason>          Record as a past failure lesson / pitfall
  --until <days>              Set temporal validity window in days from now (Zep/Graphiti style)
  --supersede <query>         Invalidate older contradictory memories matching query
  --repair                    Auto-repair corrupted links or orphaned triples in doctor mode

EXAMPLES:
  # Sync guardrails directly into AGENTS.md or .cursorrules
  mnemo rules sync AGENTS.md

  # Auto-capture recent Git commit into project memory
  mnemo capture git

  # Print 24-hour brain changelog
  mnemo digest --hours 24

  # Export portable memory pack (safely shareable without .db files)
  mnemo export team-guidelines.json -s global
`;

export async function runCli(args: string[]) {
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  const { values, positionals } = parseArgs({
    args: args.slice(1),
    options: {
      scope: { type: "string", short: "s" },
      category: { type: "string", short: "c", default: "fact" },
      importance: { type: "string", short: "i", default: "normal" },
      tag: { type: "string", short: "t", multiple: true },
      resolution: { type: "string", short: "r", default: "meso" },
      limit: { type: "string", short: "l", default: "5" },
      tokens: { type: "string" },
      output: { type: "string", short: "o" },
      format: { type: "string" },
      target: { type: "string" },
      hours: { type: "string" },
      trigger: { type: "string" },
      cause: { type: "string" },
      fix: { type: "string", multiple: true },
      threshold: { type: "string" },
      negative: { type: "boolean", default: false },
      failure: { type: "string" },
      until: { type: "string" },
      supersede: { type: "string" },
      repair: { type: "boolean", default: false },
      start: { type: "boolean", default: false },
      dir: { type: "string" },
      peer: { type: "string" },
      session: { type: "string" },
      fact: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const contentOrQuery = positionals.join(" ").trim();

  try {
    switch (command) {
      case "remember":
      case "add": {
        if (!contentOrQuery) {
          console.error("❌ Error: Please provide content to remember.");
          process.exit(1);
        }

        let validUntil: number | null = null;
        if (values.until) {
          const days = parseFloat(values.until);
          if (!isNaN(days)) {
            validUntil = Date.now() + days * 24 * 60 * 60 * 1000;
          }
        }

        const id = await engine.remember({
          content: contentOrQuery,
          scope: (values.scope as MemoryScope) || "global",
          category: values.negative ? "negative_constraint" : (values.category as MemoryCategory),
          importance: values.negative ? "critical" : (values.importance as MemoryImportance),
          tags: (values.tag as string[]) || [],
          supersedes_query: values.supersede,
          is_negative_constraint: values.negative,
          outcome: values.failure ? "failure" : "neutral",
          failure_reason: values.failure || null,
          valid_until: validUntil,
        });

        console.log(`\x1b[32m✔ Memory stored successfully!\x1b[0m`);
        console.log(`  ID: \x1b[90m${id}\x1b[0m`);
        if (values.negative) console.log(`  \x1b[31m⛔ Flagged as Strict Negative Constraint\x1b[0m`);
        if (values.failure) console.log(`  \x1b[33m⚠️ Logged as Past Failure Lesson\x1b[0m`);
        if (validUntil) console.log(`  \x1b[36m⏳ Valid until: ${new Date(validUntil).toLocaleDateString()}\x1b[0m`);
        break;
      }

      case "recall":
      case "search": {
        if (!contentOrQuery) {
          console.error("❌ Error: Please provide a query to recall.");
          process.exit(1);
        }

        const start = performance.now();
        const res = await engine.recall({
          query: contentOrQuery,
          scope: (values.scope as any) || "all",
          resolution: values.resolution as ContextResolution,
          limit: parseInt(values.limit || "5", 10),
          max_tokens: values.tokens ? parseInt(values.tokens, 10) : undefined,
        });
        const elapsed = (performance.now() - start).toFixed(1);

        console.log(res.formatted);
        if (res.token_budget) {
          console.log(`\x1b[36m📦 Token Budget: ${res.token_budget.estimated_tokens} / ${res.token_budget.max_tokens} tokens (Packed: ${res.token_budget.included_items}, Dropped: ${res.token_budget.dropped_items})\x1b[0m`);
        }
        console.log(`\x1b[90m⚡ Recalled ${res.memories.length} memories in ${elapsed}ms\x1b[0m\n`);
        break;
      }

      case "inject": {
        const res = await engine.recall({
          query: contentOrQuery || "general",
          scope: (values.scope as any) || "all",
          resolution: "macro",
          limit: 5,
          max_tokens: values.tokens ? parseInt(values.tokens, 10) : undefined,
        });

        process.stdout.write(res.formatted + "\n");
        break;
      }

      case "alias": {
        const alias = positionals[0];
        const canonical = positionals.slice(1).join(" ").trim();
        if (!alias || !canonical) {
          console.error("❌ Usage: mnemo alias <short_alias> <canonical_name>");
          process.exit(1);
        }
        engine.addAlias(alias, canonical);
        console.log(`\x1b[32m✔ Alias added:\x1b[0m "${alias}" ──► "${canonical}"`);
        break;
      }

      case "aliases": {
        const aliases = engine.getAliases();
        console.log("\n\x1b[1m🔤 Canonical Entity Aliases (Cognee style)\x1b[0m");
        console.log("─".repeat(50));
        if (aliases.length === 0) {
          console.log("  (No aliases registered yet. Add with: mnemo alias <alias> <name>)");
        } else {
          for (const a of aliases) {
            console.log(`  \x1b[36m${a.alias}\x1b[0m ──► \x1b[32m${a.canonical_name}\x1b[0m`);
          }
        }
        console.log("─".repeat(50) + "\n");
        break;
      }

      case "consolidate": {
        const report = engine.consolidate();
        console.log("\n\x1b[1m🧹 Memory Consolidation & Pruning Report (MemGPT style)\x1b[0m");
        console.log("─".repeat(50));
        console.log(`  Expired memories pruned: \x1b[33m${report.pruned_memories}\x1b[0m`);
        console.log(`  Superseded records tracked: \x1b[36m${report.superseded_cleaned}\x1b[0m`);
        console.log(`  Associative links strengthened: \x1b[32m${report.links_strengthened}\x1b[0m`);
        console.log(`  Active memories remaining: \x1b[1m${report.active_memories_remaining}\x1b[0m`);
        console.log("─".repeat(50) + "\n");
        break;
      }

      case "profile": {
        const profile = engine.getPersona("user");
        console.log("\n\x1b[1m🏛️ Theory of Mind: User Worldview & Hard Constraints\x1b[0m");
        console.log("─".repeat(60));
        console.log(`\x1b[36mWorldview:\x1b[0m ${profile.worldview}`);
        console.log(`\x1b[31mHard Constraints:\x1b[0m`);
        for (const c of profile.hard_constraints) {
          console.log(`  ⚠ ${c}`);
        }
        console.log(`\x1b[33mWorking Style:\x1b[0m ${profile.working_style}`);
        console.log(`\x1b[32mPreferences:\x1b[0m ${JSON.stringify(profile.preferences, null, 2)}`);
        console.log("─".repeat(60) + "\n");
        break;
      }

      case "graph": {
        const { triples, links } = engine.getGraph(25) as any;
        console.log("\n\x1b[1m🕸️ Mnemosyne Holographic Knowledge Graph\x1b[0m");
        console.log("─".repeat(60));
        console.log("\x1b[34m[Entity Triples: (Subject) ──[Predicate]──> (Object)]\x1b[0m");
        if (triples.length === 0) {
          console.log("  (No entity triples recorded yet)");
        } else {
          for (const t of triples) {
            console.log(`  \x1b[36m(${t.subject})\x1b[0m ──[\x1b[33m${t.predicate}\x1b[0m]──> \x1b[32m(${t.object})\x1b[0m`);
          }
        }

        console.log("\n\x1b[35m[Associative Resonance Links]\x1b[0m");
        if (links.length === 0) {
          console.log("  (No associative links active yet)");
        } else {
          for (const l of links) {
            console.log(`  \x1b[90m${l.source_id.slice(0, 8)}...\x1b[0m ⚡ \x1b[90m${l.target_id.slice(0, 8)}...\x1b[0m (weight: ${(l.resonance_weight * 100).toFixed(0)}%, co-occurrences: ${l.co_occurrences})`);
          }
        }
        console.log("─".repeat(60) + "\n");
        break;
      }

      case "forget":
      case "delete": {
        if (!contentOrQuery) {
          console.error("❌ Error: Please provide ID or keyword to forget.");
          process.exit(1);
        }
        const success = engine.forget(contentOrQuery);
        if (success) {
          console.log(`\x1b[32m✔ Matching memory deactivated.\x1b[0m`);
        } else {
          console.log(`\x1b[33m⚠ No active memory found matching: "${contentOrQuery}".\x1b[0m`);
        }
        break;
      }

      case "remedy":
      case "fix": {
        if (!contentOrQuery) {
          console.error("❌ Error: Please specify error or symptom to troubleshoot. e.g. mnemo remedy '401 unauthorized'");
          process.exit(1);
        }
        const remedies = engine.getRemedies(contentOrQuery);
        if (remedies.length === 0) {
          console.log(`\x1b[33m⚠ No automated remediation playbook found for: "${contentOrQuery}".\x1b[0m`);
        } else {
          console.log("\n\x1b[1m🛠️ Automated Remediation Playbooks (Reflexion)\x1b[0m");
          console.log("─".repeat(60));
          for (const r of remedies) {
            console.log(`\x1b[36mProblem:\x1b[0m ${r.problem_summary}`);
            console.log(`\x1b[31mRoot Cause:\x1b[0m ${r.root_cause}`);
            console.log(`\x1b[32mFix Steps:\x1b[0m`);
            r.fix_steps.forEach((step, idx) => console.log(`  ${idx + 1}. \x1b[33m${step}\x1b[0m`));
            console.log("─".repeat(60));
          }
          console.log("");
        }
        break;
      }

      case "reflect": {
        if (!contentOrQuery) {
          console.error("❌ Error: Please provide a topic to reflect on. e.g. mnemo reflect 'architecture'");
          process.exit(1);
        }
        const reflection = engine.reflect(contentOrQuery);
        if (!reflection) {
          console.log(`\x1b[33m⚠ Not enough active memories found on topic "${contentOrQuery}" to synthesize reflection.\x1b[0m`);
        } else {
          console.log(`\x1b[32m✔ Thematic Reflection Generated!\x1b[0m`);
          console.log("─".repeat(60));
          console.log(reflection.abstraction);
          console.log(`\x1b[90m(Synthesized from ${reflection.source_memory_ids.length} memories)\x1b[0m`);
          console.log("─".repeat(60));
        }
        break;
      }

      case "reflections": {
        const list = engine.getReflections(contentOrQuery || undefined);
        console.log("\n\x1b[1m🔮 Higher-Order Thematic Reflections (Generative Agents & A-MEM)\x1b[0m");
        console.log("─".repeat(60));
        if (list.length === 0) {
          console.log("  (No reflections recorded yet. Generate with: mnemo reflect <topic>)");
        } else {
          for (const item of list) {
            console.log(`\x1b[36mTopic: [${item.topic}]\x1b[0m \x1b[90m(${new Date(item.created_at).toLocaleDateString()})\x1b[0m`);
            console.log(item.abstraction);
            console.log("─".repeat(60));
          }
        }
        console.log("");
        break;
      }

      case "doctor": {
        const report = engine.doctor(Boolean(values.repair));
        console.log("\n\x1b[1m🩺 Context Doctor: Memory Health & Integrity Audit (Letta 2026)\x1b[0m");
        console.log("─".repeat(60));
        const color = report.health_score >= 90 ? "\x1b[32m" : report.health_score >= 70 ? "\x1b[33m" : "\x1b[31m";
        console.log(`  Health Score: ${color}${report.health_score} / 100\x1b[0m`);
        console.log(`  Total Memories: ${report.total_memories} (Active: ${report.active_count})`);
        console.log(`  Stale Memories: ${report.stale_count}`);
        console.log(`  Orphaned Triples: ${report.orphaned_triples}`);

        if (report.issues_detected.length > 0) {
          console.log("\n\x1b[33m[Detected Diagnostic Issues]\x1b[0m");
          report.issues_detected.forEach((i) => console.log(`  ⚠ ${i}`));
        } else {
          console.log("\n\x1b[32m✔ No structural corruption detected. Memory graph is healthy!\x1b[0m");
        }

        if (report.repairs_performed.length > 0) {
          console.log("\n\x1b[32m[Repairs Performed]\x1b[0m");
          report.repairs_performed.forEach((r) => console.log(`  ✔ ${r}`));
        } else if (!values.repair && report.issues_detected.length > 0) {
          console.log("\n\x1b[90mRun 'mnemo doctor --repair' to execute automated repairs.\x1b[0m");
        }
        console.log("─".repeat(60) + "\n");
        break;
      }

      case "purge": {
        if (!contentOrQuery) {
          console.error("❌ Error: Please provide ID or keyword to purge.");
          process.exit(1);
        }
        const receipt = engine.purge(contentOrQuery);
        if (!receipt) {
          console.log(`\x1b[33m⚠ No memory found matching: "${contentOrQuery}".\x1b[0m`);
        } else {
          console.log("\n\x1b[1m🔒 Cryptographic Deletion Receipt (EU AI Act & Right to be Forgotten)\x1b[0m");
          console.log("─".repeat(60));
          console.log(`  Memory ID: \x1b[36m${receipt.memory_id}\x1b[0m`);
          console.log(`  SHA-256 Proof: \x1b[33m${receipt.sha256_hash}\x1b[0m`);
          console.log(`  Timestamp: ${new Date(receipt.purged_at).toISOString()}`);
          console.log(`  Status: \x1b[32mPermanently Eradicated from all indexes & vectors\x1b[0m`);
          console.log(`  ${receipt.evidence}`);
          console.log("─".repeat(60) + "\n");
        }
        break;
      }

      case "timeline":
      case "history": {
        if (!contentOrQuery) {
          console.error("❌ Error: Please provide ID or concept to inspect timeline.");
          process.exit(1);
        }
        const events = engine.timeline(contentOrQuery);
        console.log(`\n\x1b[1m📜 Immutable Memory Event Timeline (Mem0 Jan 2026)\x1b[0m`);
        console.log(`Target: \x1b[36m"${contentOrQuery}"\x1b[0m`);
        console.log("─".repeat(60));
        if (events.length === 0) {
          console.log("  (No chronological events logged for this target)");
        } else {
          for (const ev of events) {
            const tagColor = ev.event_type === "CREATED" ? "\x1b[32m" : ev.event_type === "SUPERSEDED" ? "\x1b[33m" : "\x1b[31m";
            console.log(`  ${tagColor}[${ev.event_type}]\x1b[0m \x1b[90m${new Date(ev.timestamp).toLocaleTimeString()}\x1b[0m by \x1b[35m${ev.actor}\x1b[0m`);
            console.log(`    └─ ${ev.payload}`);
          }
        }
        console.log("─".repeat(60) + "\n");
        break;
      }

      case "export": {
        const pack = engine.exportPack((values.scope as any) || "all");
        const outFile = values.output || positionals[0] || `mnemosyne-pack-${Date.now()}.json`;
        await Bun.write(outFile, JSON.stringify(pack, null, 2));
        console.log(`\n\x1b[32m✔ Exported ${pack.memories.length} memories (${pack.triples.length} triples, ${pack.aliases.length} aliases) to ${outFile}\x1b[0m`);
        console.log(`  Scope: \x1b[36m${pack.scope}\x1b[0m`);
        console.log(`  SHA-256 Checksum: \x1b[90m${pack.checksum}\x1b[0m\n`);
        break;
      }

      case "import": {
        const inFile = positionals[0];
        if (!inFile) {
          console.error("❌ Usage: mnemo import <pack-file.json>");
          process.exit(1);
        }
        const file = Bun.file(inFile);
        if (!(await file.exists())) {
          console.error(`❌ Error: Pack file not found: ${inFile}`);
          process.exit(1);
        }
        const raw = await file.text();
        const packData = JSON.parse(raw);
        const result = await engine.importPack(packData);
        console.log(`\n\x1b[32m✔ Successfully imported memory pack!\x1b[0m`);
        console.log(`  Memories imported: \x1b[32m${result.imported_memories}\x1b[0m`);
        console.log(`  Triples imported: \x1b[36m${result.imported_triples}\x1b[0m`);
        console.log(`  Aliases imported: \x1b[33m${result.imported_aliases}\x1b[0m\n`);
        break;
      }

      case "topics":
      case "clusters": {
        const threshold = values.threshold ? parseFloat(values.threshold) : 0.55;
        const clusters = engine.getClusters(threshold);
        console.log("\n\x1b[1m🏷️ Thematic Knowledge Clusters (Leader Clustering)\x1b[0m");
        console.log("─".repeat(60));
        if (clusters.length === 0) {
          console.log("  (No active memories to cluster)");
        } else {
          for (const c of clusters) {
            console.log(`  \x1b[35m[${c.id}]\x1b[0m \x1b[1m${c.label}\x1b[0m (${c.size} memories)`);
            console.log(`    Keywords: \x1b[36m${c.keywords.join(", ")}\x1b[0m`);
          }
        }
        console.log("─".repeat(60) + "\n");
        break;
      }

      case "drift": {
        if (!contentOrQuery) {
          console.error("❌ Error: Please provide a statement to test for semantic drift. e.g. mnemo drift 'Kita pakai node'");
          process.exit(1);
        }
        const threshold = values.threshold ? parseFloat(values.threshold) : 0.35;
        const drift = await engine.detectDrift(contentOrQuery, threshold);
        if (drift.is_drift) {
          console.log(`\n\x1b[31m🚨 SEMANTIC DRIFT DETECTED!\x1b[0m`);
          console.log(`  Divergence Score: \x1b[33m${drift.divergence_score}\x1b[0m`);
          console.log(`  Explanation: ${drift.explanation}`);
          console.log(`  Conflicting Memory ID: \x1b[90m${drift.conflicting_memory_id}\x1b[0m\n`);
        } else {
          console.log(`\n\x1b[32m✔ No semantic drift detected.\x1b[0m Statement aligns with established baseline memory.\n`);
        }
        break;
      }

      case "workspace": {
        const ws = engine.getWorkspace();
        console.log("\n\x1b[1m📁 Detected Workspace Context\x1b[0m");
        console.log("─".repeat(50));
        console.log(`  Project: \x1b[32m${ws.project_name}\x1b[0m`);
        console.log(`  Root: \x1b[36m${ws.root_path}\x1b[0m`);
        console.log(`  Git Repository: \x1b[33m${ws.is_git ? "Yes" : "No"}\x1b[0m`);
        console.log("─".repeat(50) + "\n");
        break;
      }

      case "rules": {
        const sub = positionals[0];
        const targetPath = values.target || positionals[1] || "AGENTS.md";
        const format = (values.format as any) || undefined;
        const scope = (values.scope as any) || "all";

        if (sub === "sync") {
          const res = engine.syncRules(targetPath, format, scope);
          console.log(`\n\x1b[32m✔ Synced ${res.ruleCount} rules (${res.negativeCount} negative guardrails) to ${res.filePath}\x1b[0m`);
          console.log(`  Status: ${res.updatedExisting ? "Updated existing section" : "Created new file"}\n`);
        } else {
          // Default: export to stdout or file
          const res = engine.exportRules(format || "agents.md", scope);
          if (values.output) {
            await Bun.write(values.output, res.content);
            console.log(`\n\x1b[32m✔ Exported rules to ${values.output}\x1b[0m\n`);
          } else {
            console.log("\n" + res.content + "\n");
          }
        }
        break;
      }

      case "capture": {
        const sub = positionals[0] || "git";
        if (sub === "git") {
          const res = await engine.captureGit({ scope: values.scope });
          if (res.captured) {
            console.log(`\n\x1b[32m✔ ${res.message}\x1b[0m`);
            console.log(`  Subject: \x1b[1m${res.subject}\x1b[0m`);
            console.log(`  Category: \x1b[36m${res.category}\x1b[0m\n`);
          } else {
            console.log(`\n\x1b[33mℹ ${res.message}\x1b[0m\n`);
          }
        } else if (sub === "error" || sub === "playbook") {
          const trigger = values.trigger || positionals[1];
          const cause = values.cause || positionals[2];
          const fixSteps = values.fix || (positionals.slice(3).length > 0 ? positionals.slice(3) : []);

          if (!trigger || !cause || fixSteps.length === 0) {
            console.error("❌ Usage: mnemo capture error --trigger '<err>' --cause '<cause>' --fix '<step1>' [--fix '<step2>']");
            process.exit(1);
          }

          const res = await engine.captureError({
            triggerPattern: trigger,
            problemSummary: `Fix for: ${trigger}`,
            rootCause: cause,
            fixSteps: fixSteps,
            scope: values.scope,
          });

          console.log(`\n\x1b[32m✔ Recorded Reflexion remediation playbook!\x1b[0m`);
          console.log(`  Playbook ID: \x1b[90m${res.playbookId}\x1b[0m`);
          console.log(`  Memory ID: \x1b[90m${res.memoryId}\x1b[0m\n`);
        } else {
          console.error("❌ Unknown capture target. Use 'mnemo capture git' or 'mnemo capture error'");
          process.exit(1);
        }
        break;
      }

      case "digest":
      case "changelog": {
        const hours = values.hours ? parseInt(values.hours, 10) : 24;
        const digest = engine.getDigest(hours);
        console.log("\n" + digest.markdown_report + "\n");
        break;
      }

      case "dashboard":
      case "ui": {
        console.log(`\n\x1b[1m🏛️ Mnemosyne Web Dashboard\x1b[0m`);
        console.log("─".repeat(50));
        console.log(`  URL: \x1b[36mhttp://localhost:8788/dashboard\x1b[0m`);
        console.log(`  Direct App: \x1b[36mhttp://localhost:8788/\x1b[0m`);
        console.log(`  Context Doctor: \x1b[32mActive (1-Click Repair)\x1b[0m`);
        console.log(`  Visual Graph: \x1b[35mCanvas 2D Interactive\x1b[0m`);
        console.log("─".repeat(50) + "\n");
        break;
      }

      case "mcp": {
        const sub = positionals[0] || "status";
        const target = (positionals[1] || "opencode") as any;

        if (sub === "install") {
          const res = engine.configureMcp(target);
          if (res.success) {
            console.log(`\n\x1b[32m✔ ${res.message}\x1b[0m`);
            console.log(`  Target: \x1b[1m${res.target}\x1b[0m`);
            console.log(`  Status: ${res.alreadyConfigured ? "Updated existing configuration" : "Added new entry"}\n`);
          } else {
            console.error(`\n\x1b[31m❌ ${res.message}\x1b[0m\n`);
            process.exit(1);
          }
        } else {
          // Status
          console.log(`\n\x1b[1m🔌 Mnemosyne MCP Client Integration Status\x1b[0m`);
          console.log("─".repeat(60));
          for (const client of ["opencode", "claude", "cursor"] as const) {
            const status = engine.getMcpStatus(client);
            const badge = status.isConfigured
              ? "\x1b[32m[CONFIGURED]\x1b[0m"
              : (status.exists ? "\x1b[33m[NOT CONFIGURED]\x1b[0m" : "\x1b[90m[NO CONFIG FILE]\x1b[0m");
            console.log(`  ${client.padEnd(10)} ${badge}`);
            console.log(`  File: \x1b[90m${status.configPath}\x1b[0m`);
          }
          console.log("─".repeat(60));
          console.log(`Tip: Run \x1b[36mmnemo mcp install <opencode|claude|cursor>\x1b[0m to configure.\n`);
        }
        break;
      }

      case "service": {
        const sub = positionals[0] || "status";

        if (sub === "install") {
          const res = engine.installService({ enableAndStart: values.start });
          if (res.success) {
            console.log(`\n\x1b[32m✔ ${res.message}\x1b[0m`);
            console.log(`  Unit File: \x1b[90m${res.servicePath}\x1b[0m`);
            console.log(`  To start daemon: \x1b[36msystemctl --user start mnemosyne\x1b[0m`);
            console.log(`  To enable auto-start on login: \x1b[36msystemctl --user enable mnemosyne\x1b[0m\n`);
          } else {
            console.error(`\n\x1b[31m❌ ${res.message}\x1b[0m\n`);
            process.exit(1);
          }
        } else if (sub === "start" || sub === "stop" || sub === "restart") {
          const res = engine.controlService(sub);
          if (res.success) {
            console.log(`\n\x1b[32m✔ ${res.message}\x1b[0m\n`);
          } else {
            console.error(`\n\x1b[31m❌ ${res.message}\x1b[0m\n`);
            process.exit(1);
          }
        } else {
          // Status
          const status = engine.getServiceStatus();
          console.log(`\n\x1b[1m⚙️ Mnemosyne Systemd Service Status\x1b[0m`);
          console.log("─".repeat(60));
          console.log(`  Installed: \x1b[33m${status.installed ? "Yes" : "No"}\x1b[0m`);
          console.log(`  Service Path: \x1b[90m${status.servicePath}\x1b[0m`);
          console.log(`  State: ${status.active ? "\x1b[32mActive (running)\x1b[0m" : "\x1b[90mInactive / Stopped\x1b[0m"}`);
          if (status.statusOutput && status.statusOutput !== "Service unit is not installed.") {
            console.log("\n  systemctl status output:");
            console.log("  " + status.statusOutput.split("\n").slice(0, 6).join("\n  "));
          }
          console.log("─".repeat(60) + "\n");
        }
        break;
      }

      case "backup": {
        const sub = positionals[0] || "create";

        if (sub === "list") {
          const backups = engine.listBackups(values.dir);
          console.log(`\n\x1b[1m💾 Mnemosyne Database Snapshots (Atomic Online Backups)\x1b[0m`);
          console.log("─".repeat(65));
          if (backups.length === 0) {
            console.log("  (No backup snapshots found)");
          } else {
            for (const b of backups) {
              const dateStr = new Date(b.createdAt).toLocaleString();
              console.log(`  \x1b[36m${b.filename}\x1b[0m (${(b.sizeBytes / 1024).toFixed(1)} KB)`);
              console.log(`    Date: ${dateStr} | Path: \x1b[90m${b.path}\x1b[0m`);
            }
          }
          console.log("─".repeat(65) + "\n");
        } else if (sub === "restore") {
          const targetFile = positionals[1];
          if (!targetFile) {
            console.error("❌ Usage: mnemo backup restore <backup-file.db>");
            process.exit(1);
          }
          const res = engine.restore(targetFile);
          if (res.success) {
            console.log(`\n\x1b[32m✔ ${res.message}\x1b[0m\n`);
          } else {
            console.error(`\n\x1b[31m❌ ${res.message}\x1b[0m\n`);
            process.exit(1);
          }
        } else {
          // Default: create
          const res = engine.backup(values.dir);
          if (res.success) {
            console.log(`\n\x1b[32m✔ ${res.message}\x1b[0m`);
            console.log(`  Path: \x1b[36m${res.backupPath}\x1b[0m`);
            console.log(`  Size: \x1b[33m${(res.sizeBytes / 1024).toFixed(1)} KB\x1b[0m\n`);
          } else {
            console.error(`\n\x1b[31m❌ ${res.message}\x1b[0m\n`);
            process.exit(1);
          }
        }
        break;
      }

      case "preflight": {
        const cmdToCheck = positionals.slice(1).join(" ") || contentOrQuery;
        if (!cmdToCheck) {
          console.error("Usage: mnemo preflight <command>");
          process.exit(1);
        }
        const verdict = await engine.preflight(cmdToCheck);
        if (verdict.allowed) {
          console.log(`\x1b[32m✔ PREFLIGHT PASSED [${verdict.risk_level.toUpperCase()}]:\x1b[0m Command conforms to system guardrails.`);
          process.exit(0);
        } else {
          console.error(`\x1b[31m⛔ PREFLIGHT BLOCKED [${verdict.violation_type?.toUpperCase()}]:\x1b[0m`);
          console.error(`  Reason: \x1b[33m${verdict.blocked_reason}\x1b[0m`);
          if (verdict.recommendation) {
            console.error(`  Recommendation: \x1b[36m${verdict.recommendation}\x1b[0m`);
          }
          process.exit(1);
        }
        break;
      }

      case "calibrate": {
        const query = positionals.slice(1).join(" ") || contentOrQuery;
        if (!query) {
          console.error("Usage: mnemo calibrate <goal_or_failed_command>");
          process.exit(1);
        }
        const res = engine.calibrateTool(query);
        if (res.has_match && res.recommended_command) {
          console.log(`\n\x1b[32m✔ Calibrated Tool Solution Found:\x1b[0m`);
          console.log(`  Recommended Command: \x1b[1m\x1b[36m${res.recommended_command}\x1b[0m`);
          console.log(`  Matching Demonstrations: ${res.demonstrations.length}\n`);
          for (const d of res.demonstrations) {
            console.log(`  • Goal: ${d.goal}`);
            if (d.failed_command) console.log(`    Failed: \x1b[31m${d.failed_command}\x1b[0m`);
            console.log(`    Fix: \x1b[32m${d.fixed_command}\x1b[0m (Success count: ${d.success_count})`);
          }
          console.log("");
        } else {
          console.log(`\n\x1b[33mNo historical trajectory found for query: "${query}"\x1b[0m\n`);
        }
        break;
      }

      case "dream": {
        const isDryRun = positionals.includes("--dry-run");

        // 1. Hermes Delta Reflection over ingested chat notes
        const hermesReport = await engine.dreamHermes({ dry_run: isDryRun });

        // 2. Hippocampal Sleep Pass (decay pruning, clustering, orphaned edge cleanup)
        const decayDays = values.until ? parseInt(values.until, 10) : 14;
        const report = await engine.dream({ dry_run: isDryRun, decay_days: decayDays });

        console.log(`\n🌙 Mnemosyne Autonomous Dreamer Pass Complete:`);
        console.log(`  • Delta Notes Processed:   \x1b[36m${hermesReport.input_delta_count}\x1b[0m`);
        console.log(`  • New Facts Extracted:     \x1b[32m${hermesReport.facts_added}\x1b[0m`);
        console.log(`  • Facts Superseded:        \x1b[33m${hermesReport.facts_superseded}\x1b[0m`);
        console.log(`  • Patterns Recognized:     \x1b[35m${hermesReport.patterns_found}\x1b[0m`);
        console.log(`  • Synthesized Reflections: \x1b[36m${report.synthesized_reflections}\x1b[0m`);
        console.log(`  • Pruned Stale Memories:   \x1b[33m${report.pruned_stale_memories}\x1b[0m`);
        console.log(`  • Compacted Graph Edges:   \x1b[35m${report.compacted_graph_edges}\x1b[0m\n`);

        if (!isDryRun) {
          try {
            db.query("PRAGMA wal_checkpoint(TRUNCATE);").get();
          } catch {}
        }
        break;
      }

      case "staleness": {
        console.log(`\n🔍 Scanning workspace code staleness across anchored memories...`);
        const report = engine.scanStaleness();
        console.log(`  Total Anchored: ${report.total_anchored}`);
        console.log(`  Fresh: \x1b[32m${report.fresh_count}\x1b[0m | Stale: \x1b[33m${report.stale_count}\x1b[0m | Unlinked: \x1b[31m${report.unlinked_count}\x1b[0m\n`);
        if (report.stale_items.length > 0) {
          for (const item of report.stale_items) {
            console.log(`  • [${item.status.toUpperCase()}] ${item.file_path}: ${item.reason}`);
          }
          console.log("");
        }
        break;
      }

      case "blackboard": {
        const sub = positionals[0] || "list";
        const sessionId = positionals[1] || "default";
        if (sub === "list") {
          const entries = engine.blackboard.list(sessionId);
          console.log(`\n📋 Shared Epistemic Blackboard [Session: ${sessionId}] (${entries.length} items):`);
          for (const e of entries) {
            console.log(`  • [${e.state_type.toUpperCase()}] \x1b[36m${e.key}\x1b[0m (v${e.version} by ${e.author_agent_id}):`);
            console.log(`    ${JSON.stringify(e.value)}`);
          }
          console.log("");
        }
        break;
      }

      case "hook": {
        const sub = positionals[0] || "install";
        const target = positionals[1] || process.cwd();
        if (sub === "uninstall") {
          const res = engine.uninstallGitHook(target);
          if (res.success) {
            console.log(`\n\x1b[32m✔ ${res.message}\x1b[0m\n`);
          } else {
            console.error(`\n\x1b[31m❌ ${res.message}\x1b[0m\n`);
            process.exit(1);
          }
        } else {
          const res = engine.installGitHook(target);
          if (res.success) {
            console.log(`\n\x1b[32m✔ ${res.message}\x1b[0m`);
            console.log(`  Target Hook: \x1b[90m${res.hook_path}\x1b[0m`);
            console.log(`  Database commits (*.db, *.db-wal, *.db-shm) will now be blocked automatically.\n`);
          } else {
            console.error(`\n\x1b[31m❌ ${res.message}\x1b[0m\n`);
            process.exit(1);
          }
        }
        break;
      }

      case "timer": {
        const sub = positionals[0] || "install";
        if (sub === "status") {
          const status = engine.getDreamerTimerStatus();
          console.log(`\n\x1b[1m⏰ Mnemosyne Autonomous Dreamer Timer Status\x1b[0m`);
          console.log("─".repeat(60));
          console.log(`  Installed: ${status.installed ? "\x1b[32mYes\x1b[0m" : "\x1b[33mNo\x1b[0m"}`);
          console.log(`  Active: ${status.active ? "\x1b[32mActive (waiting/running)\x1b[0m" : "\x1b[90mInactive\x1b[0m"}`);
          if (status.statusOutput) {
            console.log("\n  Status Detail:\n  " + status.statusOutput.split("\n").slice(0, 5).join("\n  "));
          }
          console.log("─".repeat(60) + "\n");
        } else {
          const res = engine.installDreamerTimer({ enableAndStart: true });
          if (res.success) {
            console.log(`\n\x1b[32m✔ ${res.message}\x1b[0m`);
            console.log(`  Timer Unit: \x1b[90m${res.timer_path}\x1b[0m`);
            console.log(`  Service Unit: \x1b[90m${res.service_path}\x1b[0m`);
            console.log(`  Schedule: Daily at 03:00 AM (Autonomous Sleep & Dreamer Pass)\n`);
          } else {
            console.error(`\n\x1b[31m❌ ${res.message}\x1b[0m\n`);
            process.exit(1);
          }
        }
        break;
      }

      case "prime": {
        const isJson = positionals.includes("--json");
        const workspace = positionals.find((p) => p.startsWith("/") || p.startsWith(".")) || process.cwd();
        const primer = engine.prime({ workspacePath: workspace });
        if (isJson) {
          console.log(JSON.stringify(primer, null, 2));
        } else {
          console.log("\n" + primer.markdown + "\n");
        }
        break;
      }

      case "card": {
        const limit = values.limit ? parseInt(values.limit, 10) : 15;
        const card = engine.getCard({ limit });
        console.log("\n" + card.formatted + "\n");
        break;
      }

      case "upsert": {
        const subject = positionals[0];
        const predicate = positionals[1];
        const object = positionals.slice(2).join(" ");
        if (!subject || !predicate || !object) {
          console.error("Usage: mnemo upsert <subject> <predicate> <object>");
          process.exit(1);
        }
        const res = await engine.upsertFact({ subject, predicate, object });
        console.log(`\n\x1b[32m✔ Fact [${res.action.toUpperCase()}]:\x1b[0m ${res.subject} ${res.predicate} ${res.object}`);
        if (res.previous_object) {
          console.log(`  Previous value superseded: '${res.previous_object}'`);
        }
        if (res.contradiction_resolved) {
          console.log(`  Self-healing: Opposing contradiction superseded by recency.`);
        }
        console.log("");
        break;
      }

      case "delete-source": {
        const session = values.trigger || positionals[0]; // support session or arg
        const res = engine.deleteBySource({ source_session: session });
        console.log(`\n\x1b[32m✔ Provenance Purge Complete:\x1b[0m`);
        console.log(`  Memories Purged: ${res.memories_deleted}`);
        console.log(`  Triples Purged: ${res.triples_deleted}\n`);
        break;
      }

      case "ingest": {
        if (!contentOrQuery) {
          console.error("❌ Error: Please provide content to ingest.");
          process.exit(1);
        }
        const res = await engine.ingest({
          content: contentOrQuery,
          peer: values.peer || "user",
          session_id: values.session || undefined,
          category: values.category as any,
          is_fact: Boolean(values.fact),
        });
        console.log(`\n\x1b[32m✔ Ingested successfully!\x1b[0m`);
        console.log(`  Action: \x1b[36m${res.action}\x1b[0m`);
        console.log(`  Notes ID: ${res.note_id}`);
        if (res.stored_in_facts) {
          console.log(`  Fact ID: \x1b[33m${res.fact_id || res.memory_id}\x1b[0m`);
        }
        console.log("");
        break;
      }

      case "stats": {
        const stats = engine.getStats();
        console.log("\n\x1b[1m📊 Mnemosyne Observability & Storage Monitor (Hermes Protocol)\x1b[0m");
        console.log("─".repeat(60));
        console.log(`  Total Memories:    \x1b[36m${stats.total_memories}\x1b[0m (Active Facts: \x1b[32m${stats.active_facts}\x1b[0m, Superseded: \x1b[33m${stats.superseded_facts}\x1b[0m)`);
        console.log(`  Raw Notes (L3):    \x1b[35m${stats.notes_count}\x1b[0m`);
        console.log(`  Patterns (Habits): \x1b[34m${stats.patterns_count}\x1b[0m`);
        console.log(`  Dream Delta Passes:\x1b[32m${stats.dreams_count}\x1b[0m`);
        console.log(`  Evicted Records:   \x1b[31m${stats.eviction_count}\x1b[0m`);
        console.log(`  Database File:     \x1b[33m${stats.db_size_formatted}\x1b[0m (${stats.db_size_bytes} bytes)`);
        console.log(`  Free System RAM:   \x1b[32m${stats.free_ram_mb} MB\x1b[0m`);
        console.log("─".repeat(60) + "\n");
        break;
      }

      case "dream-delta":
      case "hermes-dream": {
        const report = await engine.dreamHermes({
          session_id: values.session || undefined,
          force: Boolean(values.force),
        });
        console.log("\n\x1b[1m🌙 Hermes Background Delta Dreamer Pass\x1b[0m");
        console.log("─".repeat(60));
        console.log(`  Delta Notes Processed: \x1b[36m${report.input_delta_count}\x1b[0m`);
        console.log(`  Facts Added / Updated: \x1b[32m${report.facts_added}\x1b[0m`);
        console.log(`  Facts Superseded:      \x1b[33m${report.facts_superseded}\x1b[0m`);
        console.log(`  Patterns Extracted:    \x1b[35m${report.patterns_found}\x1b[0m`);
        console.log("─".repeat(60) + "\n");
        break;
      }

      default:
        console.error(`Unknown command: ${command}. Run 'mnemo help' for usage.`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`\x1b[31mError:\x1b[0m`, err.message);
    process.exit(1);
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2));
}
