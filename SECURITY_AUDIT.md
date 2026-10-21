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

## Residual risks

- **Default root.** The default root is the daemon's working directory. If the daemon starts from `$HOME`, every repo under `$HOME` is reachable, including one a user just cloned from an untrusted source. That repo's config is neutralised for the keys listed above, but git config has other exec-capable keys we may not have covered. Set `MNEMO_WORKSPACE_ROOTS` explicitly in production.
- **Stored anchors.** `staleness` and `scan` re-read anchors already stored in the DB. Anchors stored through the API were checked at insert time. Anchors created with the CLI, or older rows, are trusted as they are.
- **Same-user threat model.** The confinement holds against an untrusted REST caller or MCP agent. It does not hold against code already running as the same user.
- **Migration guess.** A legacy remote vector is attributed to whatever remote model is configured at upgrade time. If the user switched models before upgrading, run `mnemo reembed --force`.
- **Local embedder.** It is lexical (sparse hash). Paraphrased queries such as "travel plans" versus "trip to Kyoto" miss unless a real embedder is configured. This is a quality limit, not a security one.
- **Model quality.** Reflect sometimes produced an "insight" that restates two near-duplicate facts. Insights can reach the peer card. This is a model-quality issue, not a security one.

## How to run the tests

```bash
export NO_PROXY=127.0.0.1,localhost    # the suite talks to local mock servers / spawned daemons
bun test --timeout 20000               # full suite
bun run typecheck                      # tsc --noEmit
python3 -m unittest discover -s integrations/hermes-plugin-mnemo-personal/tests
```
