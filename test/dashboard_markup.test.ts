/**
 * Dashboard markup regressions: no inline event handlers anywhere (static HTML or
 * HTML built at runtime in the script), every declarative action is allow-listed
 * and defined, and the command palette runs the command that was clicked.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getDashboardHtml } from "../src/dashboard/template.ts";
import { initSchema } from "../src/db/schema.ts";
import { listPeers } from "../src/engine/representation.ts";

const html = getDashboardHtml("/tmp/x.db", "testnonce1234567890ab");

describe("dashboard markup", () => {
  test("no inline on*= handlers or javascript: URLs, in markup or in runtime-built HTML strings", () => {
    const handlers = html.match(/\son[a-z]+\s*=\s*["']/gi) || [];
    expect(handlers).toEqual([]);
    expect(html).not.toMatch(/javascript:/i);
  });

  test("every data-* action is allow-listed and defined as a function", () => {
    const allow = JSON.parse(/const ACTION_NAMES = new Set\((\[[^\]]*\])\)/.exec(html)![1]) as string[];
    const used = new Set<string>();
    for (const m of html.matchAll(/data-(?:click|change|input|enter|submit|backdrop)="([A-Za-z_]\w*)"/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(30);
    for (const name of used) {
      expect(allow).toContain(name);
      expect(html).toMatch(new RegExp(`function ${name}\\(`));
    }
  });

  test("the only <script> carries the nonce; an invalid nonce is never echoed", () => {
    expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script nonce="testnonce1234567890ab">']);
    const bad = getDashboardHtml("/tmp/x.db", '"><script>alert(1)</script>');
    expect(bad).not.toContain("alert(1)");
    expect(bad.match(/<script\b[^>]*>/g)).toEqual(["<script>"]);
  });

  test("command palette runs the clicked item of the FILTERED list (used to index the full list)", () => {
    expect(html).toContain("cmdVisible = items");
    expect(html).toMatch(/const cmd = cmdVisible\[Number\(idx\)\]/);
  });

  test("no hard-coded fake status (stale test count, pid, port) in the status bar", () => {
    expect(html).not.toMatch(/Tests Passing/);
    expect(html).not.toMatch(/PID \d+/);
    expect(html).not.toMatch(/DAEMON ONLINE :\d+/);
  });

  test("responsive layer exists and the sidebar scrolls on short windows", () => {
    expect(html).toMatch(/@media \(max-width: 760px\)/);
    expect(html).toMatch(/\.sidebar \{[^}]*overflow-y: auto/);
  });
});

describe("peer list", () => {
  test("peer names the API would refuse are not offered to the dashboard (they 400 on every view)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const now = Date.now();
    const ins = db.prepare("INSERT INTO messages (peer, session, role, content, ts, created_at, status, digest, content_digest) VALUES (?, 's', 'user', 'x', ?, ?, 'done', ?, ?)");
    ins.run("raka", now, now, "d1", "c1");
    ins.run('<img src=x onerror="alert(1)">', now, now, "d2", "c2");
    expect(listPeers(db).map((p) => p.peer)).toEqual(["raka"]);
  });
});
