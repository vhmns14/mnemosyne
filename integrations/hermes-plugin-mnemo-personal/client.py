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
# Hermes' own recalled-context block always carries this system note.
_HERMES_FENCE_RE = re.compile(
    r"<memory-context\b[^>]*>\s*\[System note: The following is recalled memory context.*?</memory-context>", re.S | re.I
)
_FENCE_TAG_RE = re.compile(r"<(/?)(\s*)(mnemo-memory|memory-context)", re.I)
_TRIVIAL_RE = re.compile(
    r"^(ok(ay)?|oke|sip|siap|y(a|es|ep|up)?|no|nope|k|thx|thanks?( you)?|makasih|terima kasih|mantap|nice|cool|lol|wkwk+|hmm+|gas|lanjut|continue|go on|\?|!|\.)+[\s.!?]*$",
    re.I,
)
_NONCE_RE = re.compile(r"^[0-9a-f]{16,64}$")
FACT_ID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
OUTBOX_MAX_ITEMS = 20000


def defang(text: str) -> str:
    """Neutralize fence tags inside content so it cannot close our fence early."""
    return _FENCE_TAG_RE.sub(lambda m: "\u2039" + m.group(1) + m.group(2) + m.group(3), text or "")


def fence(text: str, nonce: str = "") -> str:
    if not text:
        return ""
    opener = f'<mnemo-memory data-fence="{nonce}">' if nonce else FENCE_OPEN
    return f"{opener}\n{defang(text)}\n{FENCE_CLOSE}"


def strip_fences(text: str, nonce: str = "") -> str:
    """Remove injected memory so recalled context is never re-learned.

    Only fences carrying our nonce are removed: text that merely looks like a
    fence (typed by the user or inside a pasted page) is kept, so it can never
    be used to hide content from learning.
    """
    out = text or ""
    if nonce:
        out = re.sub(r'<mnemo-memory\s+data-fence="' + re.escape(nonce) + r'"\s*>.*?</mnemo-memory>', "", out, flags=re.S | re.I)
    return _HERMES_FENCE_RE.sub("", out).strip()


def load_nonce(path: Optional[Path]) -> str:
    """Per-profile fence nonce, persisted (0600) so restarts still recognize old fences."""
    if path is not None:
        try:
            value = path.read_text(encoding="utf-8").strip()
            if _NONCE_RE.match(value):
                return value
        except OSError:
            pass
    value = os.urandom(12).hex()
    if path is not None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(value)
        except OSError:
            pass
    return value


def is_trivial(text: str) -> bool:
    t = (text or "").strip()
    return len(t) < 3 or bool(_TRIVIAL_RE.match(t))


class DaemonError(RuntimeError):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow redirects: the bearer token must not be replayed to another URL."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        raise urllib.error.HTTPError(req.full_url, code, f"redirect to {newurl} refused", headers, fp)


def _is_loopback(url: str) -> bool:
    from urllib.parse import urlparse

    host = (urlparse(url).hostname or "").lower()
    return host in ("127.0.0.1", "localhost", "::1") or host.startswith("127.")


class DaemonClient:
    def __init__(self, base_url: str, token: str = "", timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        handlers: List[Any] = [_NoRedirect()]
        if _is_loopback(self.base_url):
            # HTTP(S)_PROXY must never see localhost traffic (and its bearer token).
            handlers.append(urllib.request.ProxyHandler({}))
        self._opener = urllib.request.build_opener(*handlers)

    def request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None, timeout: Optional[float] = None) -> Dict[str, Any]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with self._opener.open(req, timeout=timeout or self.timeout) as res:
                return json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            detail = (e.read().decode(errors="replace") if e.fp else "")[:300]
            raise DaemonError(f"{method} {path.split('?')[0]} -> HTTP {e.code}: {detail}") from e
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise DaemonError(f"{method} {path.split('?')[0]} failed: {e}") from e


class Outbox:
    """Append-only JSONL outbox: writes survive daemon downtime and restarts.

    Delivery is at-least-once; the daemon deduplicates by message digest
    (peer, session, role, content, ts), and ts is fixed at capture time.

    The file holds raw conversation text, so it is created 0600 in a 0700
    directory. Network I/O never happens under the append lock: sync_turn only
    ever waits for a local file append.
    """

    def __init__(self, path: Optional[Path]):
        self.path = path
        self._lock = threading.Lock()  # guards the file / memory list
        self._flush_lock = threading.Lock()  # one flusher at a time
        self._memory: List[Dict[str, Any]] = []
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                os.chmod(path.parent, 0o700)
                if path.exists():
                    os.chmod(path, 0o600)
            except OSError:
                pass

    def _open_append(self):
        fd = os.open(str(self.path), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        return os.fdopen(fd, "a", encoding="utf-8")

    def append(self, items: List[Dict[str, Any]]) -> None:
        with self._lock:
            if self.path is None:
                self._memory.extend(items)
                del self._memory[: max(0, len(self._memory) - OUTBOX_MAX_ITEMS)]
                return
            with self._open_append() as fh:
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
        if not self._flush_lock.acquire(blocking=False):
            return 0  # another thread is already flushing
        try:
            sent = 0
            while True:
                with self._lock:
                    chunk = self._read()[:batch]
                if not chunk:
                    return sent
                client.request("POST", "/v1/messages", {"messages": chunk})  # no lock held
                with self._lock:
                    # Appends only ever add to the end, and we are the only remover.
                    self._write(self._read()[len(chunk):])
                sent += len(chunk)
        finally:
            self._flush_lock.release()

    def _write(self, items: List[Dict[str, Any]]) -> None:
        items = items[-OUTBOX_MAX_ITEMS:]
        if self.path is None:
            self._memory = list(items)
            return
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items))
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
