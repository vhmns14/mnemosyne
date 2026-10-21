# mnemo-personal — Hermes memory provider for a local Mnemosyne daemon

> Named **mnemo-personal** (tools `mnemo_*`, config `$HERMES_HOME/mnemo-personal.json`)
> because an unrelated `mnemosyne` provider already exists in the Hermes plugin catalog.

The plugin needs only the Python standard library. It talks to `mnemo serve`, which runs on `http://127.0.0.1:8788` by default. The daemon does all the learning: it queues messages, runs the LLM deriver, keeps trust scores and builds the representation.

## Install

```bash
cp -r integrations/hermes-plugin-mnemo-personal "$HERMES_HOME/plugins/mnemo-personal"
hermes memory setup     # select mnemo-personal; base_url + optional daemon token (MNEMO_PERSONAL_TOKEN)
```

## Config (`$HERMES_HOME/mnemo-personal.json`)

| key | default | meaning |
| --- | --- | --- |
| `base_url` | `http://127.0.0.1:8788` | daemon URL (env `MNEMO_PERSONAL_URL` overrides) |
| `api_key_env` | `MNEMO_PERSONAL_TOKEN` | env/secret holding the daemon's `MNEMO_AUTH_TOKEN` |
| `peer` | `user` | who the memory is about |
| `recallMode` | `hybrid` | `hybrid` (inject + tools), `context` (inject only), `tools` (tools only) |
| `contextCadence` | `4` | refresh the base layer (summary + peer card + session summary) every N turns |
| `dialecticCadence` | `3` | dialectic supplement every N turns (`0` = off) |
| `dialecticDepth` | `1` | 1 answer · 2 + self-audit · 3 + reconciliation |
| `contextTokens` | `1200` | budget for the injected block |
| `sessionStrategy` | `per-directory` | `per-directory` · `per-repo` · `per-session` · `global` (uses the `cwd` Hermes passes) |
| `timeout` | `5` | HTTP timeout (s) |

## Behaviour

- **`sync_turn`** first strips `<mnemo-memory>` and `<memory-context>` fences and skips trivial turns. It then appends the turn to `$HERMES_HOME/mnemo-personal/outbox.jsonl` and flushes the outbox to `POST /v1/messages` in a `spawn_context_thread` thread. Writes that fail stay in the outbox and are retried later, and the daemon dedupes them by `(peer, session, role, content, ts)`.
- **`prefetch`** returns a fenced block made of the base layer (refreshed at `contextCadence`), query recall (L0 abstracts) and the latest dialectic answer.
- **`queue_prefetch`** computes the next dialectic supplement in the background.
- **`on_pre_compress`** advertises `pre_compress_checkpoint_api_version = 2`. It posts the transcript to `/v1/peers/:peer/checkpoint`, which is idempotent by transcript digest, and raises when the daemon is unreachable so `checkpoint_required` fails closed.
- **`on_memory_write`** mirrors the built-in `user` and `memory` targets. `add` becomes a conclusion. `replace` and `remove` only touch a fact that exactly matches `metadata.previous_content`, and are skipped when that field is absent.
- In the `cron` and `subagent` agent contexts the plugin makes no automatic writes. No state is kept at module level: `register()` builds a new instance on every load.

## Tools

| tool | what it does |
| --- | --- |
| `mnemo_profile` | read the peer card, or overwrite/reset it |
| `mnemo_search` | search facts at tier L0, L1 or L2 |
| `mnemo_context` | standing context about the user |
| `mnemo_ask` | dialectic answer with citations |
| `mnemo_conclude` | create or delete a conclusion |
| `mnemo_feedback` | helpful or unhelpful (moves trust by +0.05 or −0.10) |

## CLI

`hermes mnemo-personal status|flush|ask "…"`

## Tests

`python3 -m unittest discover -s tests`. These tests stub `agent.memory_provider` and run against a fake daemon. They were not run against a real Hermes install.
