# Mnemosyne 🏛️
> **Ultra-Lightweight, Local-First Long-Term Holographic & Dialectic Memory Engine for AI Agents**  
> *Cross-Platform: Universal MCP Server · Standalone CLI (`mnemo`) · Local REST Daemon · Hermes Agent Pipe*  
> *Synthesizing the state-of-the-art: **Honcho** (Theory of Mind), **Holographic Memory** (Associative Resonance), **Mem0** (Graph Triples), **Zep/Graphiti** (Bi-Temporal Validity), **Supermemory** (Negative Constraints), **LangMem** (Failure Retrospectives), and **Cognee** (Entity Canonicalization).*

[![Test Suite](https://img.shields.io/badge/Tests-114%20Passed-emerald.svg)](test/)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun%201.3-fbf0df?logo=bun)](https://bun.sh)
[![Storage: SQLite WAL](https://img.shields.io/badge/Storage-SQLite%20WAL-003B57?logo=sqlite)](https://sqlite.org)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-7c3aed)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## ⚡ The Concept: Why Existing Second Memory Systems Are Bloated

SOTA memory architectures offer profound concepts, but their implementations are notoriously heavy:
- **Honcho / Zep / Letta (MemGPT)**: Often require Docker, PostgreSQL, Qdrant/Milvus, Redis, and multi-gigabyte Python microservices that burn laptop RAM and CPU.
- **Mnemosyne**: Distills the mathematical and cognitive essence of these systems into a **verified ~37MB RSS RAM, single Bun process backed by SQLite WAL**, booting in `<20ms` with `<15ms` retrieval latensi.

---

## 🧬 Architectural DNA Borrowed & Perfected

| Reference System | Core Innovation | How Mnemosyne Enhances It |
| :--- | :--- | :--- |
| **Honcho** | Theory of Mind & Dialectic Scoping | Models user worldview vs agent state, 3-tier scoping (`global`, `project`, `session`). |
| **Holographic Memory** | Associative Resonance | Spreading activation (+15% boost for connected concepts) + Fractal resolution (`macro`, `meso`, `micro`). |
| **Mem0** | Graph Triples & Invalidation | Automatic `(Subject)-[Predicate]->(Object)` extraction and `superseded_by_id` conflict invalidation. |
| **Zep / Graphiti** | Bi-Temporal Validity Windows | Facts carry `valid_from` & `valid_until` (e.g. temporary tokens, sprint goals expire automatically). |
| **Supermemory** | Strict Negative Constraints | Anti-pattern guardrails (`--negative`) are guaranteed top priority to prevent agent mistakes. |
| **LangMem** | Failure Retrospective Learning | Logs past errors and pitfalls (`--failure`), warning agents before they repeat historical bugs. |
| **Cognee** | Entity Canonicalization & Aliases | Maps colloquial shortcuts (`gw` $\to$ `albatross-gateway`) so queries never miss context. |
| **MemGPT / Letta** | Memory Consolidation Heartbeat | `mnemo consolidate` prunes expired temporal facts and strengthens synaptic co-occurrences. |
| **Stanford HippoRAG** | Hippocampal Personalized PageRank | Runs random walk with restart over graph edges to uncover deep multi-hop associations in <1ms. |
| **Reflexion** | Self-Healing Remediation Playbooks | Automatically attaches diagnostic root causes and shell fix steps when errors (e.g. 401) are detected. |
| **Generative Agents** | Higher-Order Thematic Reflection | `mnemo reflect` synthesizes multiple atomic facts into overarching conceptual insights. |
| **Letta Context Doctor** | Context Doctor & Health Audit | `mnemo doctor [--repair]` inspects graph corruption and executes automated repairs. |
| **Mem0 (Jan 2026)** | Immutable Event Ledger | `mnemo timeline <id>` tracks chronological mutation lineage (`CREATED`, `MUTATED`, `SUPERSEDED`). |
| **Audit & Compliance** | Cryptographic Deletion Receipt | `mnemo purge <id>` scrubs all traces and logs tamper-proof SHA-256 deletion evidence. |
| **Knapsack Compactor** | Context Token Budget Packing | `mnemo inject --tokens <N>` guarantees context never exceeds budget, packing P0/P1 rules first. |
| **Semantic Drift Radar** | Belief Divergence Detector | `mnemo drift <stmt>` compares proposed decisions against baseline memory and warns before commit. |
| **Leader Clustering** | Thematic Knowledge Topics | `mnemo topics` groups active memories into semantic topic clusters without ML dependencies. |
| **Portable Memory Pack** | Sanitized Zero-DB Team Sharing | `mnemo export/import` portable JSON packages with SHA-256 integrity checksums (0 database files). |
| **Workspace Auto-Scoper** | Project Context Detection | `mnemo workspace` auto-detects nearest Git root and project name for context scoping. |
| **Rule Sync Bridge** | Zero-Friction Rules Sync | `mnemo rules sync AGENTS.md / .cursorrules` safely syncs active guardrails directly into IDE/agent rule files. |
| **Auto-Capture Engine** | Continuous Ingestion | `mnemo capture git` auto-extracts bug fixes/architectural decisions from commit logs. |
| **Brain Digest** | Standup Activity Changelog | `mnemo digest --hours 24` generates human-readable retrospective reports of absorbed memories. |
| **Web Dashboard** | Zero-Dependency UI | Single-page HTML canvas visualizer, live guardrail monitor, and 1-click Context Doctor repair. |
| **Pluggable Vectors** | Resilient Hybrid Dispatch | Supports local 384-d sparse hash, Ollama, and OpenAI vectors with instant zero-crash fallback. |
| **Auto MCP Installer** | 1-Click Client Setup | `mnemo mcp install [opencode\|claude\|cursor]` automatically configures client configs without manual JSON edits. |
| **Systemd Service** | Zero-Touch Daemon Autostart | `mnemo service install` registers a lightweight systemd user service (`Restart=always`, <30MB RAM). |
| **Hermes Agent Bridge** | Instant Context Injection | `mnemo-hermes "<prompt>"` pipes guardrails & relevant memory directly into Hermes Agent `--system`. |
| **Atomic Online Backup**| Non-Blocking Snapshots | `mnemo backup create/list/restore` snapshots database atomically via SQLite `VACUUM INTO`. |
| **Obsidian / Manus / OpenClaw** | Markdown-First Vault Mirror | `mnemo vault [export\|import\|sync]` maintains transparent human-editable Markdown vault with YAML frontmatter. |
| **ICLR LongMemEval** | Standardized 5D Benchmark | `mnemo benchmark longmemeval` tests information extraction, multi-session reasoning, knowledge updates, temporal reasoning, and hallucination abstention. |
| **Stanford HippoRAG 2** | Heterogeneous Graph & Communities | Recognition Memory Gating + Passage-Entity-Triple bipartite random walk + Graphiti-style community summaries (`mnemo community`). |
| **Letta / MemGPT** | Dynamic Working Memory Blocks | `mnemo block [list\|get\|set\|append]` manages agent self-editable structured context blocks (`active_task`, `scratchpad`, `user_profile`) with token budgets. |

---

## 🚀 4-in-1 Universal Interfaces

```
 ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
 │ Hermes Agent    │   │ Claude Code /   │   │ Terminal CLI    │   │ Web Apps / Bots │
 │ CLI & Workflows │   │ Cursor / Roo    │   │ (`mnemo ...`)   │   │ Python / Go SDK │
 └────────┬────────┘   └────────┬────────┘   └────────┬────────┘   └────────┬────────┘
          │ (Tool Calls)        │ (MCP Stdio)         │ (Bash Pipes)        │ (HTTP REST)
          ▼                     ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            MNEMOSYNE ENGINE CORE                                    │
│  Storage: Local SQLite WAL (~/.mnemosyne/memory.db)                                 │
│  Scoring: 0.45*Cosine + 0.25*BM25 + 0.15*Recency + 0.15*AssociativeResonance       │
│  Guardrails: 1.4x Anti-Pattern Boost · 1.2x Failure Reflection · Bi-Temporal Filter  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Standalone CLI (`mnemo`)

The binary `mnemo` is designed for daily terminal power users:

```bash
# Store regular architecture memory
bun run bin/mnemo.ts remember "Albatross Gateway berjalan di port 8787" -s project -c architecture -i high

# Store strict negative constraint (Supermemory anti-pattern)
bun run bin/mnemo.ts remember "DILARANG run_in_background untuk task berat di laptop 16GB" --negative -i critical

# Log past failure lesson (LangMem reflection)
bun run bin/mnemo.ts remember "Proxy gagal 401 unauthorized karena proses node lama basi masih jalan di port 8787" --failure "Stale node process"

# Temporary memory valid for 7 days (Graphiti temporal validity)
bun run bin/mnemo.ts remember "Fokus sprint: integrasi Albatross telemetry" --until 7

# Entity Alias mapping (Cognee canonical mapping)
bun run bin/mnemo.ts alias gw albatross-gateway

# Hybrid recall with alias, guardrails, & past pitfalls
bun run bin/mnemo.ts recall "build proxy gw"

# Output pure system prompt string for CLI piping
bun run bin/mnemo.ts inject "build gateway"

# Memory consolidation & pruning pass
bun run bin/mnemo.ts consolidate

# Inspect Theory-of-Mind worldview & constraints
bun run bin/mnemo.ts profile

# Inspect Holographic Knowledge Graph
mnemo graph

# Export portable memory pack (safely shareable without .db files, verified with SHA-256)
mnemo export team-guidelines.json -s global

# Import portable memory pack into database & rebuild vector index locally
mnemo import team-guidelines.json

# Bi-directional sync with human-readable Markdown / Obsidian vault (.mnemo/vault/)
mnemo vault sync
mnemo vault export --vault ./my-obsidian-notes

# Run LongMemEval 5-Dimension Benchmark (ICLR 2025/2026 Protocol)
mnemo benchmark longmemeval

# List or detect thematic community summaries (Graphiti/HippoRAG 2)
mnemo community list
mnemo community detect

# Working Memory Blocks (Letta/MemGPT self-editing context)
mnemo block list
mnemo block set active_task "Refactoring auth middleware"
mnemo block append scratchpad "Found edge case in token validation"
```

---

## 2. Hermes Agent Workflows (CLI Piping & Tool Calling)

Pipe memory dynamically into Nous Hermes or any terminal LLM runner:

```bash
# Seamless system prompt injection before running query
hermes --system "$(bun run bin/mnemo.ts inject 'build proxy')" "tolong siapkan script build"
```

Sample injected prompt received by Hermes:
```text
[USER PROFILE & WORKING CONSTRAINTS]
Worldview: Values local-first, lightweight architecture, high performance, and clean ergonomics.
System Constraints: Laptop RAM 16GB: Never run heavy parallel builds.; One command at a time, always foreground.; Database files must NEVER enter git.
Preferred Stack: {"runtime":"bun","language":"typescript","database":"sqlite-wal"}

[🚨 CRITICAL NEGATIVE RULES - NEVER VIOLATE]
⛔ DILARANG run_in_background untuk task berat di laptop 16GB

[ACTIVE CONTEXTUAL RECALL]
Albatross Gateway berjalan di Bun port 8787 dengan cache sub-15ms | Proxy gagal 401 unauthorized karena proses node lama basi masih jalan di port 8787
```

---

## 3. Model Context Protocol (MCP) Server

Connect Mnemosyne directly into **Claude Desktop**, **Cursor**, **OpenCode**, **Roo Code**, or **Hermes Agent**:

Add to your `mcpServers` configuration (`claude_desktop_config.json` or `opencode.json`):

```json
{
  "mcpServers": {
    "mnemosyne": {
      "command": "bun",
      "args": ["run", "/path/to/mnemosyne/src/mcp.ts"]
    }
  }
}
```

### Exposed MCP Tools:
- `recall_memory(query, scope, resolution, limit, include_expired)`: Search long-term memory with guardrails.
- `remember_memory(content, scope, category, importance, is_negative_constraint, outcome, failure_reason, valid_days)`: Store fact with full metadata.
- `add_alias(alias, canonical_name)`: Map colloquial abbreviations to canonical names.
- `consolidate_memories()`: Run temporal pruning and associative link strengthening.
- `get_profile(entity_type)`: Fetch Theory-of-Mind user worldview & constraints.
- `forget_memory(id_or_query)`: Deactivate memory.
- `export_vault(target_dir)`: Export memories to Markdown vault (.mnemo/vault) with YAML frontmatter.
- `sync_vault(target_dir)`: Bi-directional reconciliation between SQLite and Markdown vault.
- `run_benchmark()`: Execute LongMemEval 5-Dimension standardized evaluation suite.
- `get_community_summaries(limit)`: Retrieve hierarchical community summaries (HippoRAG 2 / Graphiti).
- `get_context_block(name)`: Read dynamic working memory block (Letta/MemGPT).
- `update_context_block(name, content, token_limit)`: Update working memory block with token budget enforcement.
- `append_context_block(name, content)`: Append to working memory block safely.
- `list_context_blocks()`: List all active context blocks and token usage.

---

## 4. Localhost REST Daemon & Visual Web Dashboard (Port 8788)

Start the zero-overhead HTTP daemon and visual dashboard:
```bash
bun run src/server.ts
```
Visit **`http://localhost:8788/dashboard`** or **`http://localhost:8788/`** in your browser to inspect the interactive 2D Canvas Knowledge Graph, monitor active negative constraints, execute 1-click Context Doctor repairs, and view 24-hour activity digests!

### REST API Endpoints:
* `GET    /dashboard` $\to$ Visual single-page HTML web dashboard (zero dependencies)
* `GET    /v1/health` $\to$ Daemon status & storage info
* `POST   /v1/memory/remember` $\to$ Store fact & extract triples (supports `valid_until`, `is_negative_constraint`, `failure_reason`)
* `POST   /v1/memory/recall` $\to$ Hybrid retrieval with bi-temporal filtering & resonance
* `GET    /v1/digest` $\to$ 24-hour Brain activity digest & changelog
* `GET    /v1/rules/export` $\to$ Export active guardrails in `agents.md`, `cursorrules`, or `claude.md`
* `POST   /v1/rules/sync` $\to$ Safely sync guardrails into target file with markers
* `POST   /v1/memory/capture/git` $\to$ Auto-capture latest commit into project memory
* `POST   /v1/memory/capture/error` $\to$ Record Reflexion troubleshooting playbook
* `GET    /v1/doctor/audit` $\to$ Check graph integrity & orphan triples
* `POST   /v1/doctor/repair` $\to$ Execute automated Context Doctor health repair
* `GET    /v1/memory/timeline` $\to$ Chronological mutation audit trail
* `DELETE /v1/memory/:id` $\to$ Deactivate memory
* `POST   /v1/vault/export` $\to$ Export memories to Markdown vault (.mnemo/vault)
* `POST   /v1/vault/sync` $\to$ Bi-directional reconciliation with Markdown vault
* `GET    /v1/benchmark/longmemeval` $\to$ Run LongMemEval benchmark and get JSON/markdown score report
* `GET    /v1/communities` $\to$ Retrieve high-level graph community summaries
* `GET    /v1/blocks` $\to$ List all working memory blocks
* `GET    /v1/blocks/:id` $\to$ Get working memory block by name
* `POST   /v1/blocks/:id` $\to$ Update working memory block content
* `POST   /v1/blocks/:id/append` $\to$ Append line to working memory block
* `DELETE /v1/blocks/:id` $\to$ Delete custom working memory block

---

## 🛠️ Last-Mile Operational Tooling

### 1. 1-Click MCP Client Auto-Configuration
Instantly injects Mnemosyne into your coding agent's configuration:
```bash
# For OpenCode (~/.config/opencode/opencode.json)
mnemo mcp install opencode

# For Claude Desktop / Code (~/.claude/claude_desktop_config.json)
mnemo mcp install claude

# Check all integration statuses
mnemo mcp status
```

### 2. Systemd Background User Service
Runs Mnemosyne continuously in the background on user login without terminal tabs:
```bash
# Generate & install unit to ~/.config/systemd/user/mnemosyne.service
mnemo service install

# Check status or control
mnemo service status
systemctl --user start mnemosyne
```

### 3. Hermes Dedicated CLI Wrapper (`mnemo-hermes`)
Executes Hermes Agent with project guardrails and relevant memories pre-injected:
```bash
mnemo-hermes "build project and deploy to cloudflare"
```

### 4. Non-Blocking Atomic Online Backup
Snapshots SQLite database safely without locking concurrent reads/writes:
```bash
# Create atomic snapshot in ~/.mnemosyne/backups/
mnemo backup

# List all available snapshots
mnemo backup list

# Restore from a snapshot
mnemo backup restore ~/.mnemosyne/backups/mnemosyne-backup-1725450000000.db
```

---

## 🧪 Testing & Verification
The engine is rigorously validated using comprehensive unit, integration, stress, and MemoryAgentBench benchmark test suites:

```bash
bun test
```
```text
✓ storage.test.ts (3 tests)
✓ hybrid.test.ts (2 tests)
✓ holographic.test.ts (2 tests)
✓ advanced_features.test.ts (5 tests)
✓ api.test.ts (3 tests)
✓ hipporag_remediation.test.ts (4 tests)
✓ deep_stress_and_benchmark.test.ts (6 tests: 50 noise items, rapid concurrency, Mem0 ledger)
✓ compactor_pack_drift.test.ts (6 tests: Knapsack packing, Drift Radar, Clustering, Packs, Workspace)
✓ security_and_regression.test.ts (15 tests: Anti-mass deletion, Regex sanitization, Double-count fix, CORS, Bounded HippoRAG, ByteOffset alignment, Dialectic scope inheritance, Pack triples persistence, Atomic purge, Escaped backup path)
✓ ecosystem_and_dashboard.test.ts (6 tests: Rules sync, Git/Error auto-capture, Digest, Pluggable vectors, Dashboard UI, REST endpoints)
✓ operations_and_integrations.test.ts (4 tests: Atomic online backup, MCP auto-config, Systemd service, Hermes injection)
✓ cognitive_expansion.test.ts (10 tests: Shell interceptor, Trajectory calibration, Git anchor, Sleep/dreamer pass, Epistemic blackboard, L1 ring buffer)
✓ autonomous_and_prime.test.ts (4 tests: Pre-commit hook, Systemd timer, Session primer, Semantic deduplication)
✓ pragmatic_architecture.test.ts (7 tests: BM25 first, Dedup upsert, Standing card, Category decay, Declarative vs imperative, PII delete, Honcho conflict resolution)
✓ hermes_architecture.test.ts (6 tests: 3-Layer storage, Hash fast-path, Retrieval budget, TTL sweeper, Capacity eviction, Dreaming watermark)
✓ enhancements_and_hardening.test.ts (5 tests: Backup path, Noise filter, Alias auto-canonicalization, Offline dreamer fallback, Telemetry metrics)
✓ production_critique_fixes.test.ts (5 tests: Dynamic weighting & score clamp, Polarity conflict invalidation, Real-time TTL, Safe word-boundary forget, Recency feedback loop)
✓ dreamer_and_ingest_fixes.test.ts (5 tests: Ingest notes, Watermark tracking, Exact predicates, Reinforced facts)
✓ vault.test.ts (4 tests: YAML frontmatter, Category folders export, Content diff import, Bi-directional sync)
✓ longmemeval.test.ts (1 test: ICLR 5-dimension benchmark: extraction, multi-session, updates, temporal, abstention)
✓ hipporag2_and_community.test.ts (3 tests: Recognition memory gating, Heterogeneous bipartite graph, Community summaries)
✓ blocks.test.ts (4 tests: Default blocks, Get/Set with token budget, Clean line append, Custom blocks lifecycle)
✓ sota_integration.test.ts (4 tests: REST vault sync, LongMemEval endpoint, Community summaries, Blocks lifecycle)

114 pass, 0 fail, 621 expect assertions (~1.8s total)
```

