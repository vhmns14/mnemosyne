/**
 * Multi-process robustness regressions: claim ownership, crash recovery,
 * idempotent re-observation, concurrent schema init on one file.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../src/db/schema.ts";
import { ingestMessages, claimBatch, completeBatch, failBatch, releaseDeadClaims, CLAIM_OWNER, queueStats } from "../src/engine/messages.ts";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

function deadPid(): number {
  // A pid that existed and exited: spawn a trivial process and wait for it.
  const p = Bun.spawnSync(["true"]);
  return (p as any).pid as number;
}

describe("claim ownership", () => {
  test("a SIGKILLed worker's claim is released at once (not after the 10-minute lease)", () => {
    ingestMessages(db, [{ peer: "raka", content: "gue suka kopi susu gula aren" }]);
    const host = CLAIM_OWNER.split(":")[0];
    const ghost = `${host}:${deadPid()}:dead`;
    expect(claimBatch(db, 5, Date.now(), ghost)!.messages.length).toBe(1);
    expect(queueStats(db).processing).toBe(1);
    // Our claim sees the dead owner and takes the batch over immediately.
    const mine = claimBatch(db, 5);
    expect(mine?.messages.length).toBe(1);
    expect(completeBatch(db, mine!.messages.map((m) => m.id))).toBe(1);
    expect(queueStats(db).done).toBe(1);
  });

  test("a live owner's claim is never stolen before the lease, and another host's claim waits for the lease", () => {
    ingestMessages(db, [{ peer: "raka", content: "gue suka teh tarik" }]);
    const host = CLAIM_OWNER.split(":")[0];
    claimBatch(db, 5, Date.now(), `${host}:${process.pid}:other`);
    expect(claimBatch(db, 5)).toBeNull();
    expect(releaseDeadClaims(db)).toBe(0);
    db.exec(`UPDATE messages SET claimed_by = 'otherbox:1:x'`);
    expect(releaseDeadClaims(db)).toBe(0);
    expect(releaseDeadClaims(db, Date.now() + 11 * 60 * 1000)).toBe(1);
  });

  test("a worker whose lease was taken over cannot complete or fail the new owner's claim", () => {
    ingestMessages(db, [{ peer: "raka", content: "gue kerja jadi backend engineer" }]);
    const slow = claimBatch(db, 5, Date.now() - 11 * 60 * 1000, "otherbox:1:slow")!;
    const fresh = claimBatch(db, 5)!; // lease expired -> taken over
    expect(fresh.messages[0].id).toBe(slow.messages[0].id);
    expect(completeBatch(db, slow.messages.map((m) => m.id), "otherbox:1:slow")).toBe(0);
    failBatch(db, slow.messages.map((m) => m.id), "late failure", Date.now(), { owner: "otherbox:1:slow" });
    expect(queueStats(db).processing).toBe(1);
    expect(completeBatch(db, fresh.messages.map((m) => m.id))).toBe(1);
  });
});

describe("concurrent processes on one file", () => {
  test("parallel schema init + ingest from several processes: no BUSY, no lost rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mnemo-conc-"));
    const file = join(dir, "m.db");
    const script = `
      import { getDatabase } from "${join(import.meta.dir, "../src/db/connection.ts")}";
      import { ingestMessages } from "${join(import.meta.dir, "../src/engine/messages.ts")}";
      const db = getDatabase(process.argv[2]);
      for (let i = 0; i < 40; i++) ingestMessages(db, [{ peer: "p", session: "w" + process.argv[3], content: "message number " + i + " from writer " + process.argv[3], ts: i + 1 }]);
    `;
    const sf = join(dir, "w.ts");
    await Bun.write(sf, script);
    const procs = [1, 2, 3, 4].map((w) => Bun.spawn([process.execPath, "run", sf, file, String(w)], { stderr: "pipe", stdout: "pipe" }));
    const codes = await Promise.all(procs.map((p) => p.exited));
    const errs = await Promise.all(procs.map((p) => new Response(p.stderr).text()));
    expect(errs.join("")).not.toMatch(/BUSY|locked/i);
    expect(codes).toEqual([0, 0, 0, 0]);
    const check = new Database(file, { readonly: true });
    expect((check.query("SELECT COUNT(*) c FROM messages").get() as any).c).toBe(160);
    check.close();
  }, 30000);
});

describe("idempotent re-observation", () => {
  test("a re-claimed batch (crash after writes, before complete) does not nudge trust; new evidence still does", async () => {
    const { MockOpenAI } = await import("./helpers/mock_openai.ts");
    const { LlmClient } = await import("../src/engine/llm.ts");
    const { runDeriverOnce } = await import("../src/engine/deriver.ts");
    const { listFacts } = await import("../src/engine/facts.ts");
    const mock = new MockOpenAI();
    try {
      const llm = new LlmClient({ url: mock.baseUrl, apiKey: "k", model: "mock", backoffMs: 1, maxRetries: 0 });
      mock.handlers.extract = () => ({ facts: [{ content: "raka prefers helix over neovim", category: "preferences", confidence: 0.9, source_message_ids: [] }], session_summaries: {} });
      ingestMessages(db, [{ peer: "raka", content: "sekarang gue pake helix, bukan neovim lagi" }]);
      await runDeriverOnce(db, llm);
      const first = listFacts(db, "raka")[0];
      // Simulate a SIGKILL between the fact writes and completeBatch: the batch is re-claimed and re-derived.
      db.exec("UPDATE messages SET status = 'pending', next_attempt_at = 0");
      await runDeriverOnce(db, llm);
      await runDeriverOnce(db, llm);
      const after = listFacts(db, "raka");
      expect(after.length).toBe(1);
      expect(after[0].trust).toBeCloseTo(first.trust, 5);
      expect(after[0].observations).toBe(1);
      // Genuinely new evidence (another message) still counts.
      ingestMessages(db, [{ peer: "raka", content: "helix enak banget, gue gak balik ke neovim" }]);
      await runDeriverOnce(db, llm);
      const third = listFacts(db, "raka")[0];
      expect(third.observations).toBe(2);
      expect(third.trust).toBeGreaterThan(first.trust);
    } finally {
      mock.stop();
    }
  });
});

describe("migration", () => {
  test("a queue created before claim ownership (no claimed_by) upgrades in place and keeps its rows claimable", () => {
    const old = new Database(":memory:");
    old.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, peer TEXT NOT NULL, session TEXT NOT NULL DEFAULT 'default',
      role TEXT NOT NULL DEFAULT 'user', content TEXT NOT NULL, ts INTEGER NOT NULL, created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'skipped')),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, claimed_at INTEGER, last_error TEXT,
      digest TEXT NOT NULL, content_digest TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'api');
      INSERT INTO messages (peer, content, ts, created_at, status, digest, content_digest) VALUES ('raka', 'gue tinggal di Bandung', 1, 1, 'pending', 'd1', 'c1');
      INSERT INTO messages (peer, content, ts, created_at, status, claimed_at, digest, content_digest) VALUES ('raka', 'gue suka kopi', 2, 2, 'processing', 1, 'd2', 'c2');`);
    initSchema(old);
    initSchema(old); // idempotent
    expect((old.query("SELECT COUNT(*) c FROM messages").get() as any).c).toBe(2);
    // The legacy 'processing' row (no owner, ancient claimed_at) is released by the lease and both are claimable.
    expect(claimBatch(old, 10)!.messages.length).toBe(2);
  });
});
