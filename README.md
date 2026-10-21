# Mnemosyne 🏛️
> **Ultra-Lightweight, Local-First Long-Term Holographic & Dialectic Memory Engine for AI Agents**  
> *Cross-Platform: Universal MCP Server · Standalone CLI (`mnemo`) · Local REST Daemon · Hermes Agent Pipe*  
> *Synthesizing the state-of-the-art: **Honcho** (Theory of Mind), **Holographic Memory** (Associative Resonance), **Mem0** (Graph Triples), **Zep/Graphiti** (Bi-Temporal Validity), **Supermemory** (Negative Constraints), **LangMem** (Failure Retrospectives), and **Cognee** (Entity Canonicalization).*

[![Test Suite](https://img.shields.io/badge/Tests-183%20Passed-emerald.svg)](test/)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun%201.3-fbf0df?logo=bun)](https://bun.sh)
[![Storage: SQLite WAL](https://img.shields.io/badge/Storage-SQLite%20WAL-003B57?logo=sqlite)](https://sqlite.org)
[![Protocol: MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-7c3aed)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## ⚡ The Concept: Why Existing Second Memory Systems Are Bloated

SOTA memory architectures offer profound concepts, but their implementations are notoriously heavy:
- **Honcho / Zep / Letta (MemGPT)**: Often require Docker, PostgreSQL, Qdrant/Milvus, Redis, and multi-gigabyte Python microservices that burn laptop RAM and CPU.
- **Mnemosyne**: Distills the mathematical and cognitive essence of these systems into a **measured ~53MB RSS RAM (idle daemon), single Bun process backed by SQLite WAL**, booting in `<20ms` with `<15ms` retrieval latensi.

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
| **Systemd Service** | Zero-Touch Daemon Autostart | `mnemo service install` registers a lightweight systemd user service (`Restart=always`, measured ~53MB RSS idle). |
| **Hermes Agent Bridge** | Instant Context Injection | `mnemo-hermes "<prompt>"` pipes guardrails & relevant memory directly into Hermes Agent `--system`. |
| **Atomic Online Backup**| Non-Blocking Snapshots | `mnemo backup create/list/restore` snapshots database atomically via SQLite `VACUUM INTO`. |
| **Obsidian / Manus / OpenClaw** | Markdown-First Vault Mirror | `mnemo vault [export\|import\|sync]` maintains transparent human-editable Markdown vault with YAML frontmatter. |
| **ICLR LongMemEval** | Standardized 5D Benchmark | `mnemo benchmark longmemeval` tests information extraction, multi-session reasoning, knowledge updates, temporal reasoning, and hallucination abstention. |
| **Stanford HippoRAG 2** | Heterogeneous Graph & Communities | Recognition Memory Gating + Passage-Entity-Triple bipartite random walk + Graphiti-style community summaries (`mnemo community`). |
| **Letta / MemGPT** | Dynamic Working Memory Blocks | `mnemo block [list\|get\|set\|append]` manages agent self-editable structured context blocks (`active_task`, `scratchpad`, `user_profile`) with token budgets. |
| **Time-Travel Diff** | Semantic Revision Diffing | `mnemo diff <targetA> [targetB]` computes word-level LCS and field-level diffs between memory revisions. |
| **Adaptive Compactor** | Model-Aware Token Packing | `mnemo inject -m <claude\|gpt4\|ollama\|hermes>` dynamically adapts token budgets to model context window. |
| **Epistemic Arbitration** | Multi-Agent Dispute Resolution | Automatically flags and arbitrates contradictory claims between cooperating swarm agents. |
| **1-Bit Binary Quantization** | Sub-Millisecond Vector Search | Compresses 384-d float vectors into 48-byte bit arrays (96.88% RAM reduction), bitwise Hamming distance fast-filter in <0.0001ms. |
| **Episodic Rollup** | Decision Ledger Auto-Compaction | `mnemo rollup` condenses micro-task session logs into a concise macro-fact, deactivating granular steps. |
| **Symbol Code Anchoring** | Function/Class Belief Anchors | Anchors memories to `file.ts#symbol` via AST/regex, preventing false staleness when unrelated lines change. |
| **Zero-LLM Intent Router** | Fast Deterministic Dispatch | `mnemo route` maps prompts to memory commands in <0.02ms with zero LLM token cost. |
| **Native SSE Stream** | Swarm Event Push Protocol | `GET /v1/events` broadcasts mutation events (`MEMORY_CREATED`, `GUARDRAIL_TRIGGERED`, etc.) without polling. |
| **Dialectic & Lexical Hardening** | Word-Order Fingerprint & FTS5 Triggers | Preserves token order and polarity distinction during fast-path dedup; native SQLite triggers synchronize full-text search across all writes. |

---

## 🧠 Personal Memory: How It Learns

Mnemosyne can learn about you from ordinary conversations, Honcho-style, using **any OpenAI-compatible Chat Completions endpoint** (OpenRouter, Ollama `/v1`, LM Studio, vLLM, LiteLLM, OpenAI).

**The loop, honestly described:**

1. **Ingest** (`POST /v1/messages`, MCP `ingest_messages`, `mnemo ingest`). Raw messages `{peer, session, role, content, ts}` go into a SQLite `messages` table and a queue. No LLM call here. Secrets are redacted (`redact.ts`), injected `<mnemo-memory>` blocks are stripped so recalled memory is never re-learned, and trivial turns ("ok", "thanks") are kept but never sent to the model. Retries are idempotent: the same `(peer, session, role, content, ts)` is stored once.
2. **Derive** (a background worker in the daemon, or `mnemo derive --once`). It batches pending messages per peer and makes one JSON-mode call that extracts **explicit facts** and **deductive conclusions** (preferences, goals, habits, constraints, projects…). Each one has a confidence, a category (`profile`, `preferences`, `entities`, `events`, `cases`, `patterns`) and the source message ids. The same call also updates a running summary for each session.
3. **Decide** (Mem0-style). Each candidate is compared with the top-k most similar existing facts (fingerprint first, then embedding cosine). If nothing is similar, it is added with no LLM call. Otherwise one more call picks `ADD`, `UPDATE <id>`, `DELETE <id>` (contradiction → old fact superseded, history kept) or `NOOP <id>` (already known → trust +0.03). Writes go through the existing `rememberMemory` pipeline, so fingerprint/semantic dedupe and triple-level conflict resolution (`LIKES` vs `DISLIKES`, single-valued predicates) still apply.
4. **Represent**. After new facts arrive, the peer's **living summary** is regenerated and a **peer card** is assembled from stable facts (trust ≥ 0.45, confidence ≥ 0.5). Every 20 new facts (`MNEMO_REFLECT_EVERY`), a **reflect** pass writes cross-memory `insight` facts that cite the facts they came from.
5. **Use**. `POST /v1/peers/:peer/ask` (dialectic) answers only from memory and cites memory ids. It abstains when nothing relevant is stored or the model cannot cite anything. `depth` 2 adds a self-audit and 3 adds reconciliation of conflicting memories. `POST /v1/peers/:peer/context` returns the fenced two-layer block for prompt injection. Recall tiers: **L0** is a ~100-token abstract per fact, **L1** is a ~2k-token overview grouped by category, and **L2** is full facts plus their source messages.

**Trust.** Each derived fact starts at trust 0.5. Feedback moves it by +0.05 (helpful) or −0.10 (unhelpful), which also feeds the existing usage counters. Re-observing a fact raises it a little. Trust re-ranks recall (×0.6 to ×1.4) and decides who makes the peer card.

**Limits.** Fact quality depends on the model you point it at. Small local models extract less and decide worse. The default local embedder is a sparse-hash projection that works mostly on wording, so it misses paraphrases. Set `MNEMO_EMBED_URL` for real embeddings. Every vector records the model that produced it, and similarity is only computed between vectors of the same model (others fall back to lexical scoring), so a provider outage or a model switch never mixes latent spaces. After switching models run `mnemo reembed` (`--dry-run` to count, `--force` to redo everything) to bring old rows onto the new model. Vectors from before per-vector model ids whose model cannot be proven are tagged `unknown:legacy`: they are left out of vector scoring (lexical fallback) until `mnemo reembed` re-embeds them, which it does by default. The daemon prints a one-line hint when such rows exist and, if a remote model is configured, re-embeds a bounded sample (`MNEMO_LEGACY_VERIFY_LIMIT`, default 20) and re-tags rows whose stored vector matches the fresh one at cosine ≥ 0.99. If the endpoint is down, the queue just waits, with backoff from 5 s up to 15 min. When a batch fails it is retried as a whole, so a re-run can bump trust on facts that already got written. Only redacted message text and fact text are sent to the LLM provider.

### Quickstart

```bash
# OpenRouter
export MNEMO_LLM_URL=https://openrouter.ai/api/v1
export MNEMO_LLM_KEY=sk-or-...            # never shown in the dashboard or status API
export MNEMO_LLM_MODEL=openai/gpt-4o-mini
# optional real embeddings (any OpenAI-compatible /v1/embeddings)
export MNEMO_EMBED_URL=https://openrouter.ai/api/v1 MNEMO_EMBED_KEY=$MNEMO_LLM_KEY MNEMO_EMBED_MODEL=openai/text-embedding-3-small

# …or fully local with Ollama
export MNEMO_LLM_URL=http://localhost:11434/v1
export MNEMO_LLM_MODEL=qwen2.5:7b-instruct
export MNEMO_EMBED_URL=http://localhost:11434/v1 MNEMO_EMBED_MODEL=nomic-embed-text

mnemo serve                                # REST + dashboard + background deriver → http://127.0.0.1:8788/
mnemo ingest "I prefer TypeScript and I'm based in Purwokerto" --peer user --session chat1
mnemo derive --once                        # or let the daemon do it (every 5 s)
mnemo profile                              # living summary + peer card
mnemo facts                                # facts with confidence, trust, category
mnemo ask "Which language should I use for this script?" --depth 2
mnemo reflect                              # cross-memory insights (no topic = personal reflect)
```

Open **http://127.0.0.1:8788/** for the dashboard's **Personal Memory** section. It has the **Profile**, **Facts** (search/filter, trust/category/tier, click a fact for its source messages, correct, delete via cryptographic purge, mark helpful or unhelpful), **Ask** (cited answers) and **Deriver** (queue, last run, last error, endpoint/model; never the key) views. The daemon binds to 127.0.0.1, and when `MNEMO_AUTH_TOKEN` is set the dashboard uses the existing cookie session.

| Endpoint | Purpose |
| :--- | :--- |
| `POST /v1/messages` | Ingest one message or `{messages:[…]}` (queued, idempotent) |
| `GET /v1/peers/:peer/representation[?refresh=1]` · `POST /v1/peers/:peer/card` | Summary + peer card · pin/unpin a manual card |
| `POST /v1/peers/:peer/ask` `{question, depth}` | Dialectic answer with citations / abstention |
| `POST /v1/peers/:peer/context` · `GET /v1/peers/:peer/search?q=&tier=L0\|L1\|L2` | Fenced two-layer context · tiered recall |
| `GET/PATCH/DELETE /v1/peers/:peer/facts[/:id]` · `POST …/facts/:id/feedback` | List/inspect (with provenance) · correct · purge · trust feedback |
| `POST /v1/peers/:peer/conclusions` · `/checkpoint` · `/reflect` | Manual conclusion · pre-compression archive (idempotent) · insights |
| `GET /v1/deriver/status` · `POST /v1/deriver/run` | Queue/last run/last error/endpoint · run now |

The MCP tools are `ingest_messages`, `ask_about_user` and `get_user_representation`. The MCP process only queues messages, and the daemon (or `mnemo derive`) does the learning. Tuning variables: `MNEMO_DERIVER=off`, `MNEMO_DERIVER_INTERVAL_MS`, `MNEMO_DERIVER_BATCH`, `MNEMO_LLM_RPM`, `MNEMO_LLM_TIMEOUT_MS`, `MNEMO_REFLECT_EVERY`.

### Hermes Agent memory provider (`mnemo-personal`)

`integrations/hermes-plugin-mnemo-personal/` is a directory memory-provider plugin. It uses only the standard library and talks to the local daemon. **It is named `mnemo-personal`, not `mnemosyne`, because the Hermes catalog already has an unrelated `mnemosyne` provider.** The tools are prefixed `mnemo_` and the config lives in `$HERMES_HOME/mnemo-personal.json`.

```bash
cp -r integrations/hermes-plugin-mnemo-personal "$HERMES_HOME/plugins/mnemo-personal"
hermes memory setup            # pick mnemo-personal; asks only for base_url (+ optional daemon token)
```

What the plugin does:

- It sends each turn to `/v1/messages` through a durable outbox. This is non-blocking, delivers at least once, and the daemon dedupes it.
- It injects a fenced base layer (summary, peer card and session summary) every `contextCadence` turns, adds query recall, and adds a dialectic supplement every `dialecticCadence` turns at `dialecticDepth`. All of this stays inside `contextTokens`.
- `recallMode` can be `hybrid`, `context` or `tools`. `sessionStrategy` can be `per-directory`, `per-repo`, `per-session` or `global`.
- It exposes six tools: `mnemo_profile`, `mnemo_search`, `mnemo_context`, `mnemo_ask`, `mnemo_conclude` and `mnemo_feedback`.
- It advertises pre-compress checkpoint API v2 and mirrors built-in USER.md/MEMORY.md writes.
- It skips automatic writes for `cron` and `subagent` agent contexts.

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

# Semantic Time-Travel Memory Diff (LCS Word & Metadata Diff between revisions)
mnemo diff mem-123-abc
mnemo diff mem-old mem-new

# Adaptive Model Budget Compactor (Adapts token budget automatically)
mnemo inject "build proxy" -m claude
mnemo inject "build proxy" -m ollama
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
- `diff_memories(target_a, target_b)`: Compare two memories or a memory and its superseded revision with word-level LCS diff.
- `rollup_session(session_id, tag, max_memories)`: Condense episodic micro-task memories into a single Decision Ledger macro-fact.
- `route_intent(prompt)`: Deterministic sub-millisecond classifier mapping prompts to memory tools without LLM token spend.
- `anchor_code_memory(memory_id, file_path, symbol_name)`: Anchor a memory belief to a specific codebase file or function/class symbol.

---

## 4. Localhost REST Daemon & Visual Web Dashboard (Port 8788)

Start the zero-overhead HTTP daemon and visual dashboard:
```bash
mnemo serve            # or: bun run src/server.ts
```
Visit **`http://localhost:8788/dashboard`** or **`http://localhost:8788/`** in your browser to inspect the interactive 2D Canvas Knowledge Graph, monitor active negative constraints, execute 1-click Context Doctor repairs, and view 24-hour activity digests!

**Workspace confinement.** Paths that arrive from a REST body or an MCP tool call (`repo_path`/`file_path` for anchoring, `cwd` for git capture, `target_dir` for git hooks and MCP backups, the rule-file `targetPath`) must resolve (realpath, symlinks followed) inside a workspace root or inside the mnemo data directory (the directory of `MNEMO_DB_PATH`, `~/.mnemosyne` by default). Roots come from `MNEMO_WORKSPACE_ROOTS` (alias `MNEMO_ANCHOR_ROOTS`), a `:`-separated list. **There is no default root**: while it is unset these features answer 403 with a message saying so, except for paths inside the data dir. A root equal to `/`, `$HOME`, an ancestor of `$HOME`, or a system directory (`/etc`, `/usr`, `/var`, `/root`, `/bin`, `/proc`, ...) is ignored and named in the 403 message. The hooks directory a `.git` file points at must also be inside a root. The CLI keeps free paths (it is you at your own shell).

```bash
export MNEMO_WORKSPACE_ROOTS=$HOME/code/project-a:$HOME/code/project-b   # not $HOME itself
```

**No git process on the API anchor path.** Anchoring reads `HEAD`, loose refs, `packed-refs` and a worktree's `gitdir`/`commondir` straight from the `.git` files (detached HEAD supported) and records the HEAD commit plus a SHA-256 of the file or symbol. Nothing is executed, so a hostile repo config cannot run anything. Git capture is the only API feature that still runs `git` (it needs the commit message); over REST/MCP it is off unless `MNEMO_ALLOW_GIT=1` is set **and** the repo, its `.git` and `.git/config` are owned by the uid running mnemo. That `git` call runs without a shell, with a timeout, with `GIT_CONFIG_NOSYSTEM=1`, and with the exec-capable repo config keys (`core.fsmonitor`, `core.pager`, `core.hooksPath`, `core.sshCommand`, `gpg.program`, `diff.external`, ...) overridden on the command line. `mnemo capture` on the CLI is not gated.

**Stored anchors are re-checked on read.** Staleness checks and scans re-validate every stored anchor against the roots in force now. An anchor outside them (older rows, CLI-made rows, a tampered DB) is reported as `untrusted` and is never opened or hashed. `mnemo staleness` on the CLI additionally trusts the current directory.

### REST API Endpoints:
* `GET    /dashboard` $\to$ Visual single-page HTML web dashboard (zero dependencies)
* `GET    /v1/health` $\to$ Daemon status & storage info
* `GET    /v1/events` $\to$ Real-Time Server-Sent Events (SSE) stream of memory mutations
* `POST   /v1/memory/remember` $\to$ Store fact & extract triples (supports `valid_until`, `is_negative_constraint`, `failure_reason`)
* `POST   /v1/memory/recall` $\to$ Hybrid retrieval with bi-temporal filtering & resonance
* `POST   /v1/memory/rollup` $\to$ Automatically compact episodic micro-logs into a Decision Ledger
* `POST   /v1/memory/route` $\to$ Fast zero-LLM intent router for natural language prompts
* `POST   /v1/memory/anchor` $\to$ Anchor memory to codebase file or specific symbol (`file.ts#symbol`)
* `GET    /v1/digest` $\to$ 24-hour Brain activity digest & changelog
* `GET    /v1/rules/export` $\to$ Export active guardrails in `agents.md`, `cursorrules`, or `claude.md`
* `POST   /v1/rules/sync` $\to$ Safely sync guardrails into target file with markers
* `POST   /v1/memory/capture/git` $\to$ Auto-capture latest commit into project memory
* `POST   /v1/memory/capture/error` $\to$ Record Reflexion troubleshooting playbook
* `GET    /v1/doctor/audit` $\to$ Check graph integrity & orphan triples
* `POST   /v1/doctor/repair` $\to$ Execute automated Context Doctor health repair
* `GET    /v1/memory/timeline` $\to$ Chronological mutation audit trail
* `GET    /v1/memory/diff` $\to$ Semantic time-travel diff between memory revisions
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
bun test                       # 183 tests (personal memory: test/personal_memory.test.ts, test/personal_api.test.ts — mock OpenAI-compatible server, no network)
python3 -m unittest discover -s integrations/hermes-plugin-mnemo-personal/tests   # 11 plugin contract tests (Hermes stubbed)
bun run typecheck
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
✓ security_audit.test.ts (7 tests: Prototype pollution, Path traversal, Symlink protection, Worktrees, Pack validation, Server Auth)
✓ sota_enhancements.test.ts (4 tests: LCS word diff, Time-travel memory revisions, Adaptive budget compactor, Swarm dispute arbitration)

125 pass, 0 fail, 696 expect assertions (~2.1s total)
```

