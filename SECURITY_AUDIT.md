# Security audit: `feat/deriver`

Final hardening round, 2026-10-21. The branch is local and has not been pushed.

## Scope

- REST daemon (`src/server.ts`, `src/auth.ts`) and the stdio MCP server (`src/mcp.ts`, `src/peer/mcp_tools.ts`)
- Engine code that touches the filesystem or spawns processes (`staleness.ts`, `capture.ts`, `hook.ts`, `backup.ts`, `vault.ts`, `rules_exporter.ts`, `service.ts`)
- The embedding pipeline (`embedder.ts`, schema migration, every vector read and write)
- The LLM deriver, reflect and context rendering (`llm.ts`, `deriver.ts`, `insights.ts`, `representation.ts`, `facts.ts`), checked against a real model
- The Hermes plugin `integrations/hermes-plugin-mnemo-personal`, through its contract tests

Earlier rounds on this branch fixed the auth bypass, DNS rebinding, CSRF, unit-file injection, vault and rule-file path traversal, fence spoofing, queue ownership, dashboard CSP and supply-chain issues (340ffd3, 4cfa574, eab7fb3, b733731, 66a06e9). Those fixes are covered by `test/security_daemon.test.ts` and `test/security_audit.test.ts` and still pass. This document covers the final round.

## Findings

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | **High** | `POST /v1/memory/anchor` and the MCP tool `anchor_code_memory` accepted any `repo_path`/`file_path`. That gave callers a file existence and SHA-256 oracle anywhere on disk (for example `/etc`, `~/.ssh`), and it ran `git log` with `cwd` set to a directory the caller chose. A hostile `.git/config` in that directory (`core.fsmonitor`, `core.pager`, `gpg.program` with `log.showSignature`) runs programs, so this was RCE. The same class of bug affected `capture/git` `cwd`, `hooks/install\|uninstall` `target_dir`, the MCP tools `create_backup`/`list_backups` `target_dir` (which can write a DB copy anywhere), and the rule-sync directory (which can plant an `AGENTS.md` anywhere). | 69e79bd |
| 2 | Medium | Vectors from different embedding models were compared with each other. This happened when a remote embedder silently fell back to the local sparse-hash one, or after a provider switch. Two vectors of the same dimension can come from unrelated latent spaces, so dedupe could merge facts that were not duplicates and recall could return phantom hits. | 0055242 |
| 3 | Medium (availability/integrity) | If the extraction reply was cut off at `max_tokens`, the whole batch failed. The same input truncates the same way every time, so that batch could never succeed. Found with a real model: 877 of 900 completion tokens were spent on pretty-printed JSON. | ba0a023 |
| 4 | Low | `parseJsonReply` threw away a complete JSON object when the model kept writing junk after it (`}}\n."}}\njob."}}…`), because it sliced to the last `}`. Found with a real model. | e3a316d |
| 5 | Low (integrity) | The decision step could send two UPDATEs to the same fact in one batch. The second one superseded a row that was already superseded and overwrote its `superseded_by_id`. Found with a real model. | e3a316d |
| 6 | Info | The test suite left temp DBs in `/tmp` and SQLite `-wal`/`-shm` files in the repo root. | c8c403e |

### Fix details

**1. Workspace confinement plus hardened git** (`src/engine/safe_paths.ts`)
- Allowed roots come from `MNEMO_WORKSPACE_ROOTS`, with `MNEMO_ANCHOR_ROOTS` accepted as an alias. The value is a `:`-separated list. The default is the working directory of the daemon or MCP process. `/` is never accepted as a root, so a daemon started from `/` allows API callers nothing until roots are configured.
- Each path from a REST body or MCP call is resolved with realpath, following symlinks, on the longest existing prefix, and must land inside a root. The anchor file must also be inside the repo, so `..`, absolute paths and symlinks that escape are refused. For git calls, the repository root that git finds by walking up from the directory must be inside a root as well. Refusals return `PathConfinementError`, which maps to HTTP 403 or an MCP error.
- `safeGit()` passes an argv array with no shell and a 5 s timeout. It sets a minimal environment (`GIT_CONFIG_NOSYSTEM=1`, `GIT_TERMINAL_PROMPT=0`, empty askpass, `PAGER=cat`, `GIT_OPTIONAL_LOCKS=0`). It passes `--no-pager` and uses `-c` overrides (command-line config beats repo config) for `core.fsmonitor=`, `core.pager=cat`, `core.hooksPath=/dev/null`, `core.sshCommand=false`, `core.askPass=`, `credential.helper=`, `diff.external=`, `log.showSignature=false`, `gpg.program=false` and `protocol.ext.allow=never`. Callers also pass `--no-ext-diff` and `--no-show-signature`.
- **Deliberate deviation:** `safe.directory` is **not** overridden. Overriding it would turn off git's ownership check (CVE-2022-24765), which is the protection against a `.git` directory owned by another user.
- The CLI still accepts any path, because that is the user typing in their own shell.
- A grep of every `spawn`, `spawnSync`, `exec` and `Bun.$` found no other process launch that uses caller-controlled input. `service.ts` runs `systemctl` with fixed argv and validates the unit values it interpolates. `mnemo-hermes` runs a local CLI with fixed argv. `session_start` `cwd` is only stored, never executed.

**2. Embedding model id per vector**
- `memory_vectors.model` is written at every insert site through `storeVector()`. `getEmbedding` tags each vector with the model that actually produced it, so a fallback is recorded as `local:sparse-hash-384`.
- Dedupe, paraphrase, drift, cluster, deriver neighbours, peer recall and hybrid recall only compare vectors whose model matches. Rows from other models fall back to lexical or BM25 scoring. Hybrid weighting now follows the model that produced the query vector, not the configured provider.
- The migration runs in place and is idempotent. A legacy row is tagged local when re-embedding its stored content locally reproduces its vector exactly. Other legacy rows get the remote model configured at upgrade time, or `legacy:unknown` if none is configured.
- `mnemo reembed [--dry-run] [--force] [--limit n]` only writes vectors that really came from the configured model, and it stops after 5 fallbacks in a row.

**3–5.** `LlmTruncatedError` is raised when `finish_reason` is `length` and the JSON is incomplete. `deriveSplitting()` then halves the batch recursively. The extraction prompt now asks for compact JSON. The reply parser takes the first balanced top-level object and handles strings and escapes. Only one destructive decision is allowed per target per batch, and later ones become ADDs.

## Test evidence

Each fix has a regression test that fails on the old code. Failure before the fix was checked by hand for finding 5 and the parser.

- `test/security_workspace_confinement.test.ts` (8 tests) builds a hostile repo whose `.git/config` runs `touch PWNED` through fsmonitor, pager and gpg.program. It shows that plain `git` does run it (control test) and that `safeGit` does not. It checks the REST and MCP boundaries for anchor, capture/git, hooks, rules sync and backup, with absolute paths, `..`, symlink escapes and `/` as a root.
- `test/embedding_model_identity.test.ts` (6 tests) covers model tagging, the case where cross-model cosine is 1.0 and dedupe must still not merge, recall ignoring foreign vectors, an in-place migration from a legacy table, and `reembed` in dry-run, provider-down and provider-up runs.
- `test/deriver_truncation.test.ts` (4 tests) covers a truncated reply raising `LlmTruncatedError` without a retry, an 8-message batch split until all 8 facts are learned, the junk-tail parser, and the duplicate UPDATE target.

Results at commit time:
- `bun test`: **288 pass, 0 fail**, 38 files (270 before this round)
- `tsc --noEmit`: clean
- Plugin: `python3 -m unittest discover -s integrations/hermes-plugin-mnemo-personal/tests`: **21 tests OK**
- Real model (OpenRouter `google/gemini-2.5-flash-lite`, `max_tokens` 900): 8 messages produced 13 facts with provenance, reflect produced 4–5 insights each citing 2–3 facts, and the summary and card were generated. L0, L1 (grouped by category) and L2 (with source-message provenance) all rendered inside the fenced context. Total spend across all real-model runs this round was **$0.0045** (key usage went from $0.18646951 to $0.19097531). Findings 3–5 came from these runs.

## Residual-risk round (2026-10-21, later the same day)

The residual risks listed by the first round were worked off. Each fix has a regression test.

| # | Was | Fix | Commit | Test |
|---|-----|-----|--------|------|
| 7 | **Default root** = daemon cwd, so a daemon started from `$HOME` exposed every repo under it | `MNEMO_WORKSPACE_ROOTS` has no default. While it is unset, anchor, capture/git `cwd`, hooks `target_dir`, backup `target_dir` and rule sync answer 403 and say why, except for paths inside the mnemo data dir. Roots equal to `/`, `$HOME`, an ancestor of `$HOME` or a system dir (`/etc`, `/usr`, `/var`, `/root`, `/bin`, `/proc`, ...) are rejected and named in the 403. A `.git` *file* can no longer point hooks install at a repo outside the roots. The CLI keeps cwd behaviour. | 48b5898 | `test/security_residual_paths.test.ts` §1 |
| 8 | **Git config exec**: the anchor path ran `git log` in a caller-chosen repo, and only the keys we knew about were neutralised | The anchor path runs **no git process**. `src/engine/git_files.ts` reads `HEAD`, loose refs, `packed-refs` and a worktree's `gitdir`/`commondir` (detached HEAD and unborn branches supported). It refuses ref traversal, and refuses a `gitdir` outside the roots. The anchor records the HEAD commit plus SHA-256 of the file or symbol. Capture/git, the one feature that needs the commit message, is off over REST/MCP unless `MNEMO_ALLOW_GIT=1` **and** the work tree, `.git` and `.git/config` are owned by the current uid. `safeGit` still applies. | 48b5898 | §2. A booby-trapped `git` first on the daemon's `PATH` is never run during anchoring. |
| 9 | **Stored anchors** were trusted as they were | Every read and verify re-validates the stored repo and file realpath against the roots in force now. An anchor outside them is reported as `untrusted` (`untrusted_count` in scans) and is never opened or hashed. The stored row is not rewritten. | 48b5898 | §3. A FIFO outside the root would block the test if it were opened. |
| 10 | **Migration guess**: legacy remote vectors were attributed to whatever model was configured at upgrade time | Legacy vectors whose model cannot be proven get `unknown:legacy`. This branch's earlier `legacy:unknown` is renamed. These vectors never match a query model, so they fall back to lexical scoring. `mnemo reembed` handles them by default. The daemon logs a one-line hint, and when a remote model is configured it runs a bounded per-row sample re-embed (`MNEMO_LEGACY_VERIFY_LIMIT`, default 20). A row whose stored vector matches the fresh one at cosine ≥ 0.99 is re-tagged with that model. | ef8b17d | `test/legacy_vectors.test.ts` |
| 11 | **Local embedder misses paraphrases** (quality) | A bilingual ID+EN stem and synonym lexical leg, plus LLM query expansion at recall and ask time. The expansion asks for 2–3 paraphrases and keywords, sends max 160 tokens, times out after 4 s, is LRU-cached and redacted, and falls back to the plain query on any failure. The README recommends remote embeddings. | 5022c77 | `test/paraphrase_recall.test.ts`, `bench/paraphrase_eval.ts` |
| 12 | **Reflect quality**: insights restating near-duplicate facts reached the peer card | A quality gate rejects an insight that is a near-duplicate of any single fact or of an existing insight, using stem-aware word overlap or same-model cosine ≥ 0.9. It also rejects one with fewer than 2 distinct sources after merging near-duplicate sources. The same insight derived again from a new source counts as a re-observation. In the card, an insight needs trust ≥ 0.6 (`MNEMO_INSIGHT_CARD_TRUST`) or a re-observation. | b6f7dea | `test/reflect_quality.test.ts` |

**Paraphrase eval** (local embedder, `bench/paraphrase_eval.ts`). hit@1 / hit@3 / MRR:

| Set | Before | + lexicon | + lexicon + LLM expansion (gemini-2.5-flash-lite) |
|-----|--------|-----------|--------------------------------------------------|
| 15 pairs (informed the synonym table) | 0.27 / 0.27 / 0.267 | 0.80 / 0.93 / 0.867 | 0.87 / 0.93 / 0.900 |
| 10 held-out pairs (written after the table was frozen) | 0.20 / 0.20 / 0.200 | 0.70 / 0.80 / 0.750 | 0.70 / 0.90 / 0.783 |

**Reflect, real model** (gemini-2.5-flash-lite, `max_tokens` 900, 10 facts including a near-duplicate pair, 2 runs): 7 insights accepted, each citing 3–5 facts, with no false rejections. None reached the card at the starting trust of 0.5.

**Spawn audit.** After this round the only process launches are `safeGit`, which is called only by capture/git (gated as above; the CLI path is not gated), and `systemctl` with fixed argv in `service.ts`. Nothing on the anchor, staleness, hooks, backup or rule-sync paths spawns a process.

**Results.** `bun test`: **313 pass, 0 fail**, 42 files. `tsc --noEmit`: clean. Plugin: **21 tests OK**. gitleaks 8.21.2: `dir .` found no leaks after a pre-existing fake `ghp_` redaction fixture was marked `gitleaks:allow`, and `git` over this round's commits found no leaks. Real-model spend for this round was **$0.0007** (key usage went from $0.19186451 to $0.19251901).

## Residual risks (after this round)

- **Same-user threat model.** This one cannot be fixed. Confinement holds against an untrusted REST caller or MCP agent. It does not hold against code already running as the same uid, which can edit the DB, the env or `~/.mnemosyne` directly.
- **Opted-in git capture.** With `MNEMO_ALLOW_GIT=1`, git still runs in a repo the user owns, and that repo's config is attacker-controlled if the user cloned it from a hostile source. Ownership does not mean the config is trusted. The known exec-capable keys are overridden. Unknown future git config keys cannot be ruled out, which is why the flag is off by default and the CLI is the recommended path.
- **Anchor commit semantics.** `commit_hash` is now the repo HEAD when the anchor was taken. It used to be the last commit that touched the file. Finding that commit needs history traversal over packed objects, and we chose not to do that without git. Staleness is decided by file and symbol SHA-256, so detection is unchanged.
- **Data-dir allowance.** API callers may always write inside the data dir, for example rule sync or backups there. That is mnemo's own state, but an agent can overwrite files in it.
- **Legacy verification.** A row is re-tagged only when the configured model reproduces its own vector at cosine ≥ 0.99. Rows the provider cannot reproduce stay `unknown:legacy` until `mnemo reembed`.
- **Recall quality limits.** The lexicon is a heuristic. It over-generates keys for some English words that look like Indonesian affixes (`dinner` gives `nner`), and that only matters when a fact produces the same key. Its synonym table is small. LLM expansion cannot invent specifics it has never seen ("favorite drink" still misses "oat latte"). Real semantic recall still needs a remote embedding model. Expansion adds one LLM call per new recall query (cached), and `MNEMO_QUERY_EXPANSION=off` disables it.
- **Reflect duplicates across paraphrase.** With the local embedder, two insights that say the same thing in different words can both pass the gate. In the real run, the second pass produced insights overlapping the first in meaning but not in wording. A remote embedder enables the cosine check, and such insights stay out of the card until they are trusted.

## How to run the tests

```bash
export NO_PROXY=127.0.0.1,localhost    # the suite talks to local mock servers / spawned daemons
bun test --timeout 20000               # full suite
bun run typecheck                      # tsc --noEmit
python3 -m unittest discover -s integrations/hermes-plugin-mnemo-personal/tests
bun bench/paraphrase_eval.ts           # paraphrase eval (adds the LLM-expansion row when MNEMO_LLM_URL/MNEMO_LLM_MODEL are set)
```
