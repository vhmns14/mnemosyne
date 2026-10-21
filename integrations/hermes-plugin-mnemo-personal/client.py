"""Stdlib-only HTTP client + durable outbox for the mnemo-personal provider.

No module-level mutable state: every object here is created per provider
instance (multiplexed Hermes profiles must never share a binding).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

FENCE_OPEN = "<mnemo-memory>"
FENCE_CLOSE = "</mnemo-memory>"
_FENCE_RE = re.compile(r"<mnemo-memory\b[^>]*>.*?</mnemo-memory>", re.S | re.I)
_HERMES_FENCE_RE = re.compile(r"<memory-context\b[^>]*>.*?</memory-context>", re.S | re.I)
_TRIVIAL_RE = re.compile(
    r"^(ok(ay)?|oke|sip|siap|y(a|es|ep|up)?|no|nope|k|thx|thanks?( you)?|makasih|terima kasih|mantap|nice|cool|lol|wkwk+|hmm+|gas|lanjut|continue|go on|\?|!|\.)+[\s.!?]*$",
    re.I,
)


def fence(text: str) -> str:
    return f"{FENCE_OPEN}\n{text}\n{FENCE_CLOSE}" if text else ""


def strip_fences(text: str) -> str:
    """Remove injected memory so recalled context is never re-learned."""
    return _HERMES_FENCE_RE.sub("", _FENCE_RE.sub("", text or "")).strip()


def is_trivial(text: str) -> bool:
    t = (text or "").strip()
    return len(t) < 3 or bool(_TRIVIAL_RE.match(t))


class DaemonError(RuntimeError):
    pass


class DaemonClient:
    def __init__(self, base_url: str, token: str = "", timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None, timeout: Optional[float] = None) -> Dict[str, Any]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as res:
                return json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            raise DaemonError(f"{method} {path} -> HTTP {e.code}: {detail}") from e
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise DaemonError(f"{method} {path} failed: {e}") from e


class Outbox:
    """Append-only JSONL outbox: writes survive daemon downtime and restarts.

    Delivery is at-least-once; the daemon deduplicates by message digest
    (peer, session, role, content, ts), and ts is fixed at capture time.
    """

    def __init__(self, path: Optional[Path]):
        self.path = path
        self._lock = threading.Lock()
        self._memory: List[Dict[str, Any]] = []
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, items: List[Dict[str, Any]]) -> None:
        with self._lock:
            if self.path is None:
                self._memory.extend(items)
                return
            with open(self.path, "a", encoding="utf-8") as fh:
                for item in items:
                    fh.write(json.dumps(item, ensure_ascii=False) + "\n")

    def _read(self) -> List[Dict[str, Any]]:
        if self.path is None:
            return list(self._memory)
        if not self.path.exists():
            return []
        out = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except ValueError:
                continue  # torn write from a crash: drop the fragment
        return out

    def pending(self) -> int:
        with self._lock:
            return len(self._read())

    def flush(self, client: DaemonClient, batch: int = 100) -> int:
        """Sends queued messages; removes only what the daemon acknowledged."""
        with self._lock:
            items = self._read()
            sent = 0
            while items:
                chunk = items[:batch]
                client.request("POST", "/v1/messages", {"messages": chunk})
                items = items[batch:]
                sent += len(chunk)
                self._write(items)
            return sent

    def _write(self, items: List[Dict[str, Any]]) -> None:
        if self.path is None:
            self._memory = list(items)
            return
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items), encoding="utf-8")
        os.replace(tmp, self.path)


def _find_repo_root(start: Path) -> Optional[Path]:
    cur = start.resolve()
    for p in [cur, *cur.parents]:
        if (p / ".git").exists():
            return p
    return None


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", text).strip("-")[:40] or "root"


def session_key(strategy: str, session_id: str, cwd: Optional[str]) -> str:
    """per-session | per-directory | per-repo | global (cwd from Hermes kwargs)."""
    if strategy == "global":
        return "global"
    if strategy in ("per-directory", "per-repo") and cwd:
        path = Path(cwd)
        if strategy == "per-repo":
            root = _find_repo_root(path)
            if root is not None:
                digest = hashlib.sha1(str(root).encode()).hexdigest()[:8]
                return f"repo-{_slug(root.name)}-{digest}"
        digest = hashlib.sha1(str(path.resolve()).encode()).hexdigest()[:8]
        return f"dir-{_slug(path.name)}-{digest}"
    return _slug(session_id) if session_id else f"session-{int(time.time())}"
