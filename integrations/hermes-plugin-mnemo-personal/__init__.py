"""mnemo-personal — Hermes Agent memory provider backed by a local Mnemosyne daemon.

Named ``mnemo-personal`` (tools ``mnemo_*``, config ``$HERMES_HOME/mnemo-personal.json``)
to avoid clashing with the unrelated ``mnemosyne`` provider in the Hermes catalog.

What it does:
  * sync_turn  -> queues both sides of each turn (fences stripped, trivial turns skipped)
                  into a durable outbox and flushes it to POST /v1/messages in a
                  context-preserving background thread (at-least-once, idempotent).
  * prefetch   -> two-layer context (Honcho-style): a base layer (living summary +
                  peer card + session summary) refreshed every ``contextCadence`` turns,
                  query recall each turn, and a dialectic supplement every
                  ``dialecticCadence`` turns at ``dialecticDepth``; all fenced in
                  <mnemo-memory> and packed into ``contextTokens``.
  * on_pre_compress -> checkpoint API v2: archives the transcript about to be
                  compressed (idempotent by transcript digest) and lets the deriver
                  extract from it.
  * on_memory_write -> mirrors built-in USER.md / MEMORY.md writes as conclusions.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from agent.memory_provider import MemoryProvider

try:  # Hermes >= the threading contract; fallback keeps contextvars for older hosts/tests.
    from agent.memory_provider import spawn_context_thread as _spawn_context_thread
except ImportError:  # pragma: no cover - exercised only on very old Hermes
    _spawn_context_thread = None

try:
    from .client import FACT_ID_RE, DaemonClient, DaemonError, Outbox, fence, is_trivial, load_nonce, session_key, strip_fences
except ImportError:  # loaded as a top-level module (tests / standalone)
    from client import FACT_ID_RE, DaemonClient, DaemonError, Outbox, fence, is_trivial, load_nonce, session_key, strip_fences  # type: ignore

logger = logging.getLogger(__name__)

PROVIDER_NAME = "mnemo-personal"
CONFIG_FILE = f"{PROVIDER_NAME}.json"
DEFAULTS: Dict[str, Any] = {
    "base_url": "http://127.0.0.1:8788",
    "api_key_env": "MNEMO_PERSONAL_TOKEN",
    "peer": "user",
    "recallMode": "hybrid",  # hybrid | context | tools
    "contextCadence": 4,  # refresh the base layer every N turns
    "dialecticCadence": 3,  # dialectic supplement every N turns (0 = off)
    "dialecticDepth": 1,  # 1-3
    "contextTokens": 1200,
    "sessionStrategy": "per-directory",  # per-directory | per-repo | per-session | global
    "timeout": 5.0,
}


def _spawn(fn: Callable[[], None], name: str) -> threading.Thread:
    if _spawn_context_thread is not None:
        return _spawn_context_thread(fn, name=name)
    ctx = contextvars.copy_context()
    return threading.Thread(target=lambda: ctx.run(fn), name=name, daemon=True)


def _secret(name: str) -> str:
    if not name:
        return ""
    try:
        from agent.secret_scope import get_secret  # type: ignore

        return get_secret(name) or ""
    except Exception:
        return os.environ.get(name, "")


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _tool(name: str, description: str, properties: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    return {"name": name, "description": description, "parameters": {"type": "object", "properties": properties, "required": required}}


TOOL_SCHEMAS: List[Dict[str, Any]] = [
    _tool(
        "mnemo_profile",
        "Read the user's peer card (short list of stable facts) and living summary. Pass `card` to overwrite the card; pass `card: []` with `reset: true` to go back to the learned card.",
        {"card": {"type": "array", "items": {"type": "string"}}, "reset": {"type": "boolean"}},
        [],
    ),
    _tool(
        "mnemo_search",
        "Search learned facts about the user. tier L0 = short abstracts (cheap), L1 = full facts grouped by category, L2 = full facts plus the source messages they came from.",
        {"query": {"type": "string"}, "tier": {"type": "string", "enum": ["L0", "L1", "L2"]}, "limit": {"type": "integer"}},
        ["query"],
    ),
    _tool(
        "mnemo_context",
        "Get the standing context about the user: summary, peer card, this session's summary, and memories relevant to an optional query.",
        {"query": {"type": "string"}},
        [],
    ),
    _tool(
        "mnemo_ask",
        "Ask a question about the user and get an answer synthesized ONLY from memory, with cited memory ids; it says it doesn't know when memory lacks the answer. depth 2 adds a self-audit, 3 adds reconciliation of conflicting memories.",
        {"question": {"type": "string"}, "depth": {"type": "integer", "minimum": 1, "maximum": 3}},
        ["question"],
    ),
    _tool(
        "mnemo_conclude",
        "Record a durable conclusion about the user (pass `conclusion`), or delete one by id (pass `delete_id`). Exactly one of the two.",
        {"conclusion": {"type": "string"}, "category": {"type": "string", "enum": ["profile", "preferences", "entities", "events", "cases", "patterns"]}, "delete_id": {"type": "string"}},
        [],
    ),
    _tool(
        "mnemo_feedback",
        "Tell memory whether a recalled fact helped (raises its trust) or was wrong/unhelpful (lowers it). Use the fact id from search/ask results.",
        {"fact_id": {"type": "string"}, "verdict": {"type": "string", "enum": ["helpful", "unhelpful"]}, "note": {"type": "string"}},
        ["fact_id", "verdict"],
    ),
]


class MnemoPersonalProvider(MemoryProvider):
    # Opt in to fail-closed pre-compress checkpoints: a successful return means
    # the transcript is durably archived in the daemon's SQLite store.
    pre_compress_checkpoint_api_version = 2

    def __init__(self) -> None:
        self._cfg: Dict[str, Any] = dict(DEFAULTS)
        self._home: Optional[Path] = None
        self._client: Optional[DaemonClient] = None
        self._outbox: Outbox = Outbox(None)
        self._session_id = ""
        self._session_key = ""
        self._peer = "user"
        self._peer_q = "user"
        self._writes_enabled = False
        self._turn = 0
        self._base_text = ""
        self._base_turn = -(10**9)
        self._dialectic_text = ""
        self._dialectic_turn = -(10**9)
        self._threads: List[threading.Thread] = []
        self._lock = threading.Lock()
        self._initialized = False
        self._nonce = ""
        self._cwd: Optional[str] = None

    # ------------------------------------------------------------------ core
    @property
    def name(self) -> str:
        return PROVIDER_NAME

    def is_available(self) -> bool:
        # No network here (contract). The daemon is local and writes are queued
        # in the outbox while it is down, so the provider can always activate.
        return True

    def initialize(self, session_id: str, **kwargs: Any) -> None:
        home = kwargs.get("hermes_home") or os.environ.get("HERMES_HOME")
        self._home = Path(home) if home else None
        cfg = dict(DEFAULTS)
        if self._home is not None:
            cfg.update(_read_json(self._home / CONFIG_FILE))
        self._cfg = cfg
        base_url = os.environ.get("MNEMO_PERSONAL_URL") or str(cfg.get("base_url") or DEFAULTS["base_url"])
        self._client = DaemonClient(base_url, _secret(str(cfg.get("api_key_env") or "")), float(cfg.get("timeout") or 5.0))
        self._outbox = Outbox(self._home / PROVIDER_NAME / "outbox.jsonl" if self._home is not None else None)
        self._nonce = load_nonce(self._home / PROVIDER_NAME / "fence.nonce" if self._home is not None else None)
        self._session_id = session_id or ""
        cwd = kwargs.get("cwd")
        if not cwd and cfg.get("sessionStrategy") in ("per-directory", "per-repo"):
            try:
                from agent.runtime_cwd import resolve_agent_cwd  # type: ignore

                cwd = resolve_agent_cwd()
            except Exception:
                cwd = None
        self._cwd = cwd
        self._session_key = session_key(str(cfg.get("sessionStrategy")), self._session_id, cwd)
        self._peer = str(cfg.get("peer") or "user")
        from urllib.parse import quote

        self._peer_q = quote(self._peer, safe="")
        agent_context = kwargs.get("agent_context") or "primary"
        self._writes_enabled = agent_context not in ("cron", "subagent") and kwargs.get("platform") != "cron"
        self._turn = 0
        self._initialized = True

    # ---------------------------------------------------------------- config
    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {"key": "base_url", "description": "Mnemosyne daemon URL (run `mnemo serve`)", "default": DEFAULTS["base_url"]},
            {
                "key": "api_key",
                "description": "Daemon token (MNEMO_AUTH_TOKEN), only if the daemon requires one",
                "secret": True,
                "required": False,
                "env_var": DEFAULTS["api_key_env"],
            },
        ]

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        path = Path(hermes_home) / CONFIG_FILE
        current = _read_json(path)
        current.update({k: v for k, v in (values or {}).items() if k != "api_key"})
        try:
            from utils import atomic_json_write  # type: ignore

            atomic_json_write(path, current)
        except Exception:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(current, indent=2), encoding="utf-8")
            os.replace(tmp, path)

    def get_status_config(self) -> Dict[str, Any]:
        return {
            "base_url": self._client.base_url if self._client else self._cfg.get("base_url"),
            "session": self._session_key,
            "peer": self._peer,
            "recallMode": self._cfg.get("recallMode"),
            "outbox_pending": self._outbox.pending(),
        }

    # ------------------------------------------------------------- prompting
    def system_prompt_block(self) -> str:
        mode = self._cfg.get("recallMode", "hybrid")
        lines = ["## Personal memory (mnemo-personal)"]
        if mode != "tools":
            lines.append("Relevant memory about the user is injected automatically inside <mnemo-memory> blocks. Treat it as background, not as something the user just said.")
        if mode != "context":
            lines.append(
                "Tools: mnemo_profile (peer card), mnemo_search (facts, tiers L0/L1/L2), mnemo_context, mnemo_ask (cited answers about the user), "
                "mnemo_conclude (record/delete a durable conclusion), mnemo_feedback (helpful/unhelpful on a fact)."
            )
        return "\n".join(lines)

    def _budget(self, text: str) -> str:
        limit = int(self._cfg.get("contextTokens") or 1200) * 4
        return text if len(text) <= limit else text[: max(0, limit - 1)] + "…"

    def _fetch_base(self, query: str) -> Dict[str, Any]:
        assert self._client is not None
        return self._client.request(
            "POST",
            f"/v1/peers/{self._peer_q}/context",
            {"query": query, "session": self._session_key, "tokens": int(self._cfg.get("contextTokens") or 1200), "tier": "L0"},
            timeout=min(3.0, self._client.timeout),
        )

    def _compose(self, recall_lines: List[str]) -> str:
        parts = [p for p in (self._base_text,) if p]
        if recall_lines:
            parts.append("## Relevant memories\n" + "\n".join(recall_lines))
        if self._dialectic_text:
            parts.append("## What memory says about this request\n" + self._dialectic_text)
        return fence(self._budget("\n\n".join(parts)), self._nonce) if parts else ""

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not self._initialized or self._client is None or self._cfg.get("recallMode") == "tools":
            return ""
        try:
            data = self._fetch_base(query or "")
        except DaemonError as e:
            logger.debug("mnemo-personal prefetch failed: %s", e)
            return self._compose([])
        cadence = max(1, int(self._cfg.get("contextCadence") or 1))
        if self._turn - self._base_turn >= cadence or not self._base_text:
            base = data.get("base") or {}
            parts = []
            if base.get("summary"):
                parts.append(f"## About the user\n{base['summary']}")
            if base.get("card"):
                parts.append("## Peer card\n" + "\n".join(f"- {c}" for c in base["card"][:12]))
            if base.get("session_summary"):
                parts.append(f"## This session so far\n{base['session_summary']}")
            self._base_text = "\n\n".join(parts)
            self._base_turn = self._turn
        recall = [f"- [{i.get('id', '')[:8]}] {i.get('text', '')}" for i in (data.get("recall") or [])]
        return self._compose(recall)

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        """Pre-warms the dialectic supplement for the next turn (LLM-backed, so off the hot path)."""
        cadence = int(self._cfg.get("dialecticCadence") or 0)
        if not self._initialized or cadence <= 0 or self._cfg.get("recallMode") == "tools" or not (query or "").strip():
            return
        if self._turn - self._dialectic_turn < cadence:
            return
        self._dialectic_turn = self._turn
        depth = max(1, min(3, int(self._cfg.get("dialecticDepth") or 1)))
        question = f"What should an assistant know about this person to respond well to: {strip_fences(query, self._nonce)[:500]}"

        def _run() -> None:
            try:
                assert self._client is not None
                res = self._client.request("POST", f"/v1/peers/{self._peer_q}/ask", {"question": question, "depth": depth}, timeout=60)
                self._dialectic_text = "" if res.get("abstained") else str(res.get("answer") or "")
            except DaemonError as e:
                logger.debug("mnemo-personal dialectic failed: %s", e)

        self._start(_run, "mnemo-personal-dialectic")

    # ----------------------------------------------------------------- writes
    def _start(self, fn: Callable[[], None], name: str) -> threading.Thread:
        t = _spawn(fn, name)
        with self._lock:
            self._threads = [x for x in self._threads if x.is_alive()]
            self._threads.append(t)
        t.start()
        return t

    def _flush(self) -> None:
        if self._client is None:
            return
        try:
            self._outbox.flush(self._client)
        except DaemonError as e:
            logger.debug("mnemo-personal outbox flush deferred: %s", e)

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "", messages: Optional[List[Dict[str, Any]]] = None) -> None:
        self._turn += 1
        if not self._initialized or not self._writes_enabled:
            return
        user = strip_fences(user_content or "", self._nonce)
        assistant = strip_fences(assistant_content or "", self._nonce)
        try:
            from agent.memory_manager import sanitize_context  # type: ignore

            user, assistant = sanitize_context(user).strip(), sanitize_context(assistant).strip()
        except Exception:
            pass
        if is_trivial(user) and len(assistant) < 40:
            return
        now = int(time.time() * 1000)
        items = []
        if user:
            items.append({"peer": self._peer, "session": self._session_key, "role": "user", "content": user, "ts": now})
        if assistant:
            items.append({"peer": self._peer, "session": self._session_key, "role": "assistant", "content": assistant, "ts": now + 1})
        if not items:
            return
        self._outbox.append(items)  # durable before returning; network happens off-thread
        self._start(self._flush, "mnemo-personal-sync")

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        self._join(5.0)
        if self._writes_enabled:
            self._flush()

    def on_pre_compress(self, messages: List[Dict[str, Any]], *, require_checkpoint: bool = False, **kwargs: Any) -> str:
        if not self._initialized or self._client is None:
            if require_checkpoint:
                raise RuntimeError("mnemo-personal is not initialized")
            return ""
        if not self._writes_enabled:
            return "mnemo-personal: checkpoint skipped (non-primary agent context)"
        rows = [
            {"role": m.get("role"), "content": strip_fences(m.get("content"), self._nonce)}
            for m in messages or []
            if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)
        ]
        try:
            res = self._client.request("POST", f"/v1/peers/{self._peer_q}/checkpoint", {"session": self._session_key, "messages": rows}, timeout=15)
        except DaemonError:
            if require_checkpoint:
                raise  # fail closed: the host keeps the transcript
            # Hosts without the checkpoint contract compress anyway: keep the turns in
            # the durable outbox so they are not lost while the daemon is down.
            base = int(time.time() * 1000)
            self._outbox.append(
                [{"peer": self._peer, "session": self._session_key, "role": r["role"], "content": r["content"], "ts": base + i, "source": "checkpoint"} for i, r in enumerate(rows) if r["content"]]
            )
            return ""
        state = "already archived" if res.get("duplicate") else f"{res.get('queued', 0)} new messages queued for extraction"
        return f"mnemo-personal checkpoint {res.get('checkpoint_id')}: {state}"

    def on_session_switch(self, new_session_id: str, *, parent_session_id: str = "", reset: bool = False, rewound: bool = False, **kwargs: Any) -> None:
        """Keep writes in the right session after /new, /reset, /resume, /branch or compression."""
        if not self._initialized:
            return
        self._session_id = new_session_id or self._session_id
        cwd = kwargs.get("cwd") or self._cwd
        self._session_key = session_key(str(self._cfg.get("sessionStrategy")), self._session_id, cwd)
        if reset or rewound:
            self._turn = 0
            self._base_text = ""
            self._base_turn = -(10**9)
            self._dialectic_text = ""
            self._dialectic_turn = -(10**9)

    def on_memory_write(self, action: str, target: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        if not self._initialized or not self._writes_enabled or target not in ("user", "memory"):
            return
        meta = metadata or {}
        previous = meta.get("previous_content")
        category = "profile" if target == "user" else "cases"

        def _run() -> None:
            assert self._client is not None
            try:
                if action in ("replace", "remove"):
                    if not previous:
                        return  # no exact identity: skip destructive mirroring
                    match = self._find_fact(str(previous))
                    if match and action == "remove":
                        self._client.request("DELETE", f"/v1/peers/{self._peer_q}/facts/{match}")
                    elif match and action == "replace" and content:
                        self._client.request("PATCH", f"/v1/peers/{self._peer_q}/facts/{match}", {"content": content})
                    elif action == "replace" and content:
                        self._client.request("POST", f"/v1/peers/{self._peer_q}/conclusions", {"content": content, "category": category})
                elif action == "add" and content:
                    self._client.request("POST", f"/v1/peers/{self._peer_q}/conclusions", {"content": content, "category": category})
            except DaemonError as e:
                logger.debug("mnemo-personal memory mirror failed: %s", e)

        self._start(_run, "mnemo-personal-memwrite")

    def _find_fact(self, content: str) -> Optional[str]:
        assert self._client is not None
        from urllib.parse import quote

        res = self._client.request("GET", f"/v1/peers/{self._peer_q}/facts?q={quote(content[:200])}&limit=20")
        for f in res.get("facts") or []:
            if str(f.get("content", "")).strip() == content.strip():
                return str(f.get("id"))
        return None

    # ------------------------------------------------------------------ tools
    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        if self._cfg.get("recallMode") == "context":
            return []
        return [dict(s) for s in TOOL_SCHEMAS]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs: Any) -> str:
        if self._client is None:
            return json.dumps({"error": "mnemo-personal is not initialized"})
        args = args if isinstance(args, dict) else {}
        p = f"/v1/peers/{self._peer_q}"
        writes = {"mnemo_conclude", "mnemo_feedback"} | ({"mnemo_profile"} if (args.get("reset") or isinstance(args.get("card"), list)) else set())
        if tool_name in writes and not self._writes_enabled:
            return json.dumps({"error": "mnemo-personal is read-only in this agent context (cron/subagent)"})
        try:
            if tool_name == "mnemo_profile":
                if args.get("reset"):
                    res = self._client.request("POST", f"{p}/card", {"card": None})
                elif isinstance(args.get("card"), list):
                    res = self._client.request("POST", f"{p}/card", {"card": [str(c) for c in args["card"]]})
                else:
                    res = self._client.request("GET", f"{p}/representation")
                rep = res.get("representation") or {}
                return json.dumps({"summary": rep.get("summary", ""), "card": rep.get("card", []), "pinned": rep.get("pinned", False)})
            if tool_name == "mnemo_search":
                from urllib.parse import urlencode

                tier = args.get("tier") if args.get("tier") in ("L0", "L1", "L2") else "L0"
                q = urlencode({"q": str(args.get("query", ""))[:500], "tier": tier, "limit": max(1, min(50, int(args.get("limit") or 8)))})
                res = self._client.request("GET", f"{p}/search?{q}")
                return json.dumps({"tier": res.get("tier"), "items": res.get("items", [])})
            if tool_name == "mnemo_context":
                res = self._client.request("POST", f"{p}/context", {"query": args.get("query") or "", "session": self._session_key, "tier": "L1"})
                return json.dumps({"context": res.get("text", ""), "base": res.get("base", {})})
            if tool_name == "mnemo_ask":
                res = self._client.request("POST", f"{p}/ask", {"question": str(args.get("question", ""))[:2000], "depth": max(1, min(3, int(args.get("depth") or 1)))}, timeout=90)
                return json.dumps({k: res.get(k) for k in ("answer", "abstained", "citations", "depth")})
            if tool_name == "mnemo_conclude":
                has_c, has_d = bool(args.get("conclusion")), bool(args.get("delete_id"))
                if has_c == has_d:
                    return json.dumps({"error": "pass exactly one of `conclusion` or `delete_id`"})
                if has_d:
                    if not FACT_ID_RE.match(str(args["delete_id"])):
                        return json.dumps({"error": "delete_id must be a fact id (uuid) from search/ask results"})
                    res = self._client.request("DELETE", f"{p}/facts/{args['delete_id']}")
                    return json.dumps({"deleted": bool(res.get("success")), "id": args["delete_id"]})
                res = self._client.request("POST", f"{p}/conclusions", {"content": str(args["conclusion"]), "category": args.get("category")})
                return json.dumps({"id": res.get("id"), "action": res.get("action")})
            if tool_name == "mnemo_feedback":
                if not FACT_ID_RE.match(str(args.get("fact_id", ""))):
                    return json.dumps({"error": "fact_id must be a fact id (uuid) from search/ask results"})
                if args.get("verdict") not in ("helpful", "unhelpful"):
                    return json.dumps({"error": "verdict must be helpful or unhelpful"})
                res = self._client.request("POST", f"{p}/facts/{args.get('fact_id')}/feedback", {"verdict": args.get("verdict"), "note": args.get("note")})
                return json.dumps({"id": args.get("fact_id"), "trust": res.get("trust")})
        except DaemonError as e:
            return json.dumps({"error": str(e)})
        except (TypeError, ValueError) as e:  # malformed model-supplied arguments
            return json.dumps({"error": f"invalid arguments: {e}"})
        return json.dumps({"error": f"unknown tool {tool_name}"})

    # --------------------------------------------------------------- shutdown
    def _join(self, timeout: float) -> None:
        deadline = time.time() + timeout
        with self._lock:
            threads = list(self._threads)
        for t in threads:
            t.join(timeout=max(0.0, deadline - time.time()))

    def shutdown(self) -> None:
        self._join(5.0)
        if self._writes_enabled:
            self._flush()


def register(ctx) -> None:
    """Hermes entry point: a fresh instance per load (no shared module state)."""
    ctx.register_memory_provider(MnemoPersonalProvider())
