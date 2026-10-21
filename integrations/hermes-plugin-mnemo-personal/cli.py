"""`hermes mnemo-personal <status|flush|ask>` subcommands."""

from __future__ import annotations

import json
import os
from pathlib import Path


def _provider():
    try:
        from . import MnemoPersonalProvider  # type: ignore
    except ImportError:  # pragma: no cover
        from __init__ import MnemoPersonalProvider  # type: ignore
    home = os.environ.get("HERMES_HOME")
    if not home:
        try:
            from hermes_constants import get_hermes_home  # type: ignore

            home = str(get_hermes_home())
        except Exception:
            home = None
    p = MnemoPersonalProvider()
    p.initialize("cli", hermes_home=home, cwd=os.getcwd(), agent_context="primary")
    return p


def mnemo_command(args) -> None:
    sub = getattr(args, "mnemo_command", None)
    p = _provider()
    if sub == "status":
        status = p.get_status_config()
        try:
            status["daemon"] = p._client.request("GET", "/v1/deriver/status").get("status")  # type: ignore[union-attr]
        except Exception as e:  # daemon down is a valid state; writes wait in the outbox
            status["daemon"] = f"unreachable: {e}"
        print(json.dumps(status, indent=2, default=str))
    elif sub == "flush":
        before = p._outbox.pending()
        p._flush()
        print(f"outbox: {before} -> {p._outbox.pending()} pending")
    elif sub == "ask":
        print(p.handle_tool_call("mnemo_ask", {"question": " ".join(args.question), "depth": args.depth}))
    else:
        print("Usage: hermes mnemo-personal <status|flush|ask>")


def register_cli(subparser) -> None:
    subs = subparser.add_subparsers(dest="mnemo_command")
    subs.add_parser("status", help="Show config, outbox and daemon/deriver status")
    subs.add_parser("flush", help="Send queued turns to the daemon now")
    ask = subs.add_parser("ask", help="Ask memory a question about the user")
    ask.add_argument("question", nargs="+")
    ask.add_argument("--depth", type=int, default=1)
    subparser.set_defaults(func=mnemo_command)
