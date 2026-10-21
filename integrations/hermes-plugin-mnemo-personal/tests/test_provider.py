"""Contract tests for the mnemo-personal Hermes provider (stdlib unittest, no network).

Hermes itself is not installed here, so `agent.memory_provider` is stubbed with
the documented surface (MemoryProvider ABC + spawn_context_thread). A fake
daemon (http.server on 127.0.0.1) records requests.

Run:  python3 -m unittest discover -s integrations/hermes-plugin-mnemo-personal/tests
"""

from __future__ import annotations

import contextvars
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PLUGIN_DIR = Path(__file__).resolve().parents[1]
SPAWNED: list = []


def _install_stubs() -> None:
    agent = types.ModuleType("agent")
    mp = types.ModuleType("agent.memory_provider")

    class MemoryProvider:  # documented ABC surface (subset)
        pre_compress_checkpoint_api_version = 1

    def spawn_context_thread(fn, name=None, **_):
        SPAWNED.append(name)
        ctx = contextvars.copy_context()
        return threading.Thread(target=lambda: ctx.run(fn), name=name, daemon=True)

    mp.MemoryProvider = MemoryProvider
    mp.spawn_context_thread = spawn_context_thread
    agent.memory_provider = mp
    sys.modules["agent"] = agent
    sys.modules["agent.memory_provider"] = mp


def _load_plugin():
    _install_stubs()
    spec = importlib.util.spec_from_file_location("mnemo_personal_plugin", PLUGIN_DIR / "__init__.py", submodule_search_locations=[str(PLUGIN_DIR)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["mnemo_personal_plugin"] = mod
    spec.loader.exec_module(mod)
    return mod


plugin = _load_plugin()


class FakeDaemon:
    def __init__(self):
        self.requests: list = []
        self.fail = False
        self.facts = [{"id": "11111111-1111-1111-1111-111111111111", "content": "user likes tea"}]
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _handle(self, method):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}") if length else None
                outer.requests.append((method, self.path, body, self.headers.get("Authorization")))
                if outer.fail:
                    self.send_response(503)
                    self.end_headers()
                    self.wfile.write(b"down")
                    return
                path = urlparse(self.path).path
                if path.endswith("/context"):
                    data = {"base": {"summary": "Summary v%d" % len(outer.requests), "card": ["user likes tea"], "session_summary": "talked about tea"},
                            "recall": [{"id": "22222222-2222", "text": "user drinks oolong"}], "text": ""}
                elif path.endswith("/ask"):
                    data = {"answer": "They like tea.", "abstained": False, "citations": [{"id": "1"}], "depth": body.get("depth")}
                elif path.endswith("/checkpoint"):
                    data = {"checkpoint_id": "abc123", "duplicate": False, "queued": len(body["messages"])}
                elif path.endswith("/facts") and method == "GET":
                    data = {"facts": outer.facts}
                elif path.endswith("/representation") or path.endswith("/card"):
                    data = {"representation": {"summary": "S", "card": (body or {}).get("card") or ["c"], "pinned": bool((body or {}).get("card"))}}
                elif path.endswith("/search"):
                    data = {"tier": "L2", "items": [{"id": "x", "text": "t"}]}
                else:
                    data = {"success": True, "id": "new-id", "action": "added", "trust": 0.55}
                raw = json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                self._handle("GET")

            def do_POST(self):
                self._handle("POST")

            def do_PATCH(self):
                self._handle("PATCH")

            def do_DELETE(self):
                self._handle("DELETE")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def paths(self, suffix):
        return [r for r in self.requests if urlparse(r[1]).path.endswith(suffix)]

    def stop(self):
        self.server.shutdown()


class Ctx:
    def __init__(self):
        self.providers = []

    def register_memory_provider(self, p):
        self.providers.append(p)


class ProviderTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop("MNEMO_PERSONAL_URL", None)
        self.daemon = FakeDaemon()
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "profile-a"
        self.home.mkdir()
        (self.home / "mnemo-personal.json").write_text(json.dumps({"base_url": self.daemon.url, "contextCadence": 2, "dialecticCadence": 2, "dialecticDepth": 2}))
        os.environ["MNEMO_PERSONAL_TOKEN"] = "tok-123"

    def tearDown(self):
        self.daemon.stop()
        self.tmp.cleanup()
        os.environ.pop("MNEMO_PERSONAL_TOKEN", None)

    def make(self, **kw):
        ctx = Ctx()
        plugin.register(ctx)
        p = ctx.providers[0]
        kwargs = {"hermes_home": str(self.home), "platform": "cli", "agent_context": "primary", "cwd": str(self.home)}
        kwargs.update(kw)
        p.initialize("sess-1", **kwargs)
        return p

    def wait(self, p):
        p._join(5)

    # ---- contract basics
    def test_register_returns_new_instance_and_contract_surface(self):
        ctx = Ctx()
        plugin.register(ctx)
        plugin.register(ctx)
        a, b = ctx.providers
        self.assertIsNot(a, b)
        self.assertIsInstance(a, sys.modules["agent.memory_provider"].MemoryProvider)
        self.assertEqual(a.name, "mnemo-personal")
        self.assertEqual(a.pre_compress_checkpoint_api_version, 2)
        for m in ["is_available", "initialize", "get_tool_schemas", "handle_tool_call", "get_config_schema", "save_config", "system_prompt_block",
                  "prefetch", "queue_prefetch", "sync_turn", "on_session_end", "on_pre_compress", "on_memory_write", "shutdown"]:
            self.assertTrue(callable(getattr(a, m)), m)
        before = len(self.daemon.requests)
        self.assertTrue(a.is_available())
        self.assertEqual(len(self.daemon.requests), before)  # no network

    def test_config_is_bound_to_hermes_home_never_home_dir(self):
        fake_home = Path(self.tmp.name) / "fakehome"
        fake_home.mkdir()
        old = os.environ.get("HOME")
        os.environ["HOME"] = str(fake_home)
        try:
            p = self.make()
            schema = p.get_config_schema()
            self.assertEqual([f["key"] for f in schema], ["base_url", "api_key"])
            self.assertEqual(schema[1]["env_var"], "MNEMO_PERSONAL_TOKEN")
            other = Path(self.tmp.name) / "profile-b"
            p.save_config({"base_url": "http://127.0.0.1:9999", "api_key": "secret"}, str(other))
            saved = json.loads((other / "mnemo-personal.json").read_text())
            self.assertEqual(saved["base_url"], "http://127.0.0.1:9999")
            self.assertNotIn("api_key", saved)
            p.sync_turn("I moved to Bandung last month", "Noted, Bandung it is.")
            self.wait(p)
            self.assertFalse((fake_home / ".hermes").exists())
            self.assertTrue((self.home / "mnemo-personal").is_dir())
        finally:
            if old is not None:
                os.environ["HOME"] = old

    # ---- writes
    def test_sync_turn_is_non_blocking_strips_fences_skips_trivial(self):
        p = self.make()
        injected = "<mnemo-memory>\n- user likes tea\n</mnemo-memory>"
        p.sync_turn(f"{injected}\nI started learning Rust this week", "Great choice! Rust has a steep but rewarding curve.")
        self.assertIn("mnemo-personal-sync", SPAWNED)
        self.wait(p)
        posts = self.daemon.paths("/v1/messages")
        self.assertEqual(len(posts), 1)
        msgs = posts[0][2]["messages"]
        self.assertEqual([m["role"] for m in msgs], ["user", "assistant"])
        self.assertEqual(msgs[0]["content"], "I started learning Rust this week")
        self.assertNotIn("mnemo-memory", json.dumps(msgs))
        self.assertEqual(posts[0][3], "Bearer tok-123")
        p.sync_turn("ok", "👍")
        self.wait(p)
        self.assertEqual(len(self.daemon.paths("/v1/messages")), 1)

    def test_outbox_retries_failed_writes_at_least_once(self):
        p = self.make()
        self.daemon.fail = True
        p.sync_turn("My sister lives in Surabaya", "Good to know about your sister in Surabaya.")
        self.wait(p)
        self.assertEqual(p._outbox.pending(), 2)
        self.assertTrue((self.home / "mnemo-personal" / "outbox.jsonl").exists())
        # A new provider instance (restart) still sees the durable outbox.
        p2 = self.make()
        self.assertEqual(p2._outbox.pending(), 2)
        self.daemon.fail = False
        p2.on_session_end([])
        self.assertEqual(p2._outbox.pending(), 0)
        ok_posts = [r for r in self.daemon.paths("/v1/messages")]
        last = ok_posts[-1][2]["messages"]
        self.assertEqual(last[0]["content"], "My sister lives in Surabaya")
        first_ts = ok_posts[0][2]["messages"][0]["ts"]
        self.assertEqual(last[0]["ts"], first_ts)  # same ts -> daemon dedupes retries

    def test_cron_and_subagent_contexts_never_write(self):
        for ctx in ("cron", "subagent"):
            p = self.make(agent_context=ctx)
            p.sync_turn("I prefer tabs over spaces always", "Tabs it is, consistently.")
            p.on_memory_write("add", "user", "Prefers tabs")
            self.assertIn("skipped", p.on_pre_compress([{"role": "user", "content": "x"}]))
            self.wait(p)
        self.assertEqual(self.daemon.paths("/v1/messages"), [])
        self.assertEqual(self.daemon.paths("/conclusions"), [])
        self.assertEqual(self.daemon.paths("/checkpoint"), [])

    # ---- two-layer context
    def test_prefetch_base_layer_cadence_and_dialectic_supplement(self):
        p = self.make()
        out1 = p.prefetch("what tea should I buy?")
        self.assertTrue(out1.startswith("<mnemo-memory>") and out1.endswith("</mnemo-memory>"))
        self.assertIn("Peer card", out1)
        self.assertIn("user drinks oolong", out1)
        base1 = p._base_text
        p.queue_prefetch("what tea should I buy?")  # turn 0 -> dialectic due
        self.wait(p)
        self.assertEqual(len(self.daemon.paths("/ask")), 1)
        self.assertEqual(self.daemon.paths("/ask")[0][2]["depth"], 2)
        p.sync_turn("ok", "")  # turn 1
        out2 = p.prefetch("and for the evening?")
        self.assertEqual(p._base_text, base1)  # base not refreshed before contextCadence
        self.assertIn("They like tea.", out2)
        p.queue_prefetch("and for the evening?")  # only 1 turn since last dialectic
        self.wait(p)
        self.assertEqual(len(self.daemon.paths("/ask")), 1)
        p.sync_turn("ok", "")  # turn 2
        p.prefetch("x")
        self.assertNotEqual(p._base_text, base1)  # refreshed at cadence 2
        p.queue_prefetch("x")
        self.wait(p)
        self.assertEqual(len(self.daemon.paths("/ask")), 2)

    def test_context_budget_and_recall_modes(self):
        (self.home / "mnemo-personal.json").write_text(json.dumps({"base_url": self.daemon.url, "contextTokens": 10, "recallMode": "context"}))
        p = self.make()
        out = p.prefetch("tea")
        inner = out[len("<mnemo-memory>\n"): -len("\n</mnemo-memory>")]
        self.assertLessEqual(len(inner), 40)
        self.assertEqual(p.get_tool_schemas(), [])
        (self.home / "mnemo-personal.json").write_text(json.dumps({"base_url": self.daemon.url, "recallMode": "tools"}))
        p2 = self.make()
        n = len(self.daemon.requests)
        self.assertEqual(p2.prefetch("tea"), "")
        self.assertEqual(len(self.daemon.requests), n)
        self.assertEqual(len(p2.get_tool_schemas()), 6)

    # ---- tools
    def test_tools_route_to_daemon(self):
        p = self.make()
        names = [s["name"] for s in p.get_tool_schemas()]
        self.assertEqual(names, ["mnemo_profile", "mnemo_search", "mnemo_context", "mnemo_ask", "mnemo_conclude", "mnemo_feedback"])
        self.assertTrue(all("parameters" in s for s in p.get_tool_schemas()))
        self.assertEqual(json.loads(p.handle_tool_call("mnemo_profile", {}))["card"], ["c"])
        self.assertTrue(json.loads(p.handle_tool_call("mnemo_profile", {"card": ["A", "B"]}))["pinned"])
        self.assertEqual(json.loads(p.handle_tool_call("mnemo_search", {"query": "tea", "tier": "L2"}))["tier"], "L2")
        self.assertIn("base", json.loads(p.handle_tool_call("mnemo_context", {"query": "tea"})))
        self.assertEqual(json.loads(p.handle_tool_call("mnemo_ask", {"question": "tea?", "depth": 3}))["depth"], 3)
        self.assertIn("error", json.loads(p.handle_tool_call("mnemo_conclude", {})))
        self.assertEqual(json.loads(p.handle_tool_call("mnemo_conclude", {"conclusion": "Prefers oolong"}))["action"], "added")
        self.assertTrue(json.loads(p.handle_tool_call("mnemo_conclude", {"delete_id": "abc"}))["deleted"])
        self.assertEqual(json.loads(p.handle_tool_call("mnemo_feedback", {"fact_id": "abc", "verdict": "helpful"}))["trust"], 0.55)
        self.assertIn("unknown tool", p.handle_tool_call("nope", {}))
        self.daemon.fail = True
        self.assertIn("error", json.loads(p.handle_tool_call("mnemo_ask", {"question": "x"})))

    # ---- checkpoint + memory mirror
    def test_pre_compress_checkpoint_v2(self):
        p = self.make()
        msgs = [{"role": "user", "content": "<mnemo-memory>x</mnemo-memory>I run 10k on Sundays"}, {"role": "tool", "content": "ignored"}, {"role": "assistant", "content": "Nice."}]
        res = p.on_pre_compress(msgs, require_checkpoint=True)
        self.assertIn("abc123", res)
        sent = self.daemon.paths("/checkpoint")[0][2]
        self.assertEqual([m["role"] for m in sent["messages"]], ["user", "assistant"])
        self.assertEqual(sent["messages"][0]["content"], "I run 10k on Sundays")
        self.daemon.fail = True
        with self.assertRaises(Exception):
            p.on_pre_compress(msgs, require_checkpoint=True)  # fail closed

    def test_on_memory_write_mirrors_user_and_memory_targets(self):
        p = self.make()
        p.on_memory_write("add", "user", "Prefers concise answers")
        p.on_memory_write("remove", "user", "", {})  # no previous_content -> skipped
        p.on_memory_write("remove", "memory", "", {"previous_content": "user likes tea"})
        p.on_memory_write("add", "other", "ignored")
        self.wait(p)
        concl = self.daemon.paths("/conclusions")
        self.assertEqual(len(concl), 1)
        self.assertEqual(concl[0][2]["content"], "Prefers concise answers")
        deletes = [r for r in self.daemon.requests if r[0] == "DELETE"]
        self.assertEqual(len(deletes), 1)
        self.assertTrue(deletes[0][1].endswith("/facts/11111111-1111-1111-1111-111111111111"))

    def test_session_strategies(self):
        client = sys.modules["mnemo_personal_plugin.client"] if "mnemo_personal_plugin.client" in sys.modules else None
        sk = (client.session_key if client else plugin.session_key)
        repo = Path(self.tmp.name) / "myrepo"
        (repo / ".git").mkdir(parents=True)
        (repo / "src" / "deep").mkdir(parents=True)
        self.assertTrue(sk("per-repo", "s", str(repo / "src" / "deep")).startswith("repo-myrepo-"))
        self.assertEqual(sk("per-repo", "s", str(repo / "src" / "deep")), sk("per-repo", "s", str(repo)))
        self.assertTrue(sk("per-directory", "s", str(repo / "src")).startswith("dir-src-"))
        self.assertEqual(sk("global", "s", None), "global")
        self.assertEqual(sk("per-session", "abc", str(repo)), "abc")
        self.assertEqual(sk("per-directory", "abc", None), "abc")  # no cwd -> per-session


if __name__ == "__main__":
    unittest.main()
