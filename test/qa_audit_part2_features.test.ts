import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { initSchema } from "../src/db/schema.ts";
import { MnemosyneEngine } from "../src/engine/index.ts";
import { usageMultiplier, recordProjectHit, getMemoryUsage } from "../src/engine/feedback.ts";
import { scoreCandidate } from "../src/engine/candidates.ts";

function freshEngine(): { db: Database; engine: MnemosyneEngine } {
  const db = new Database(":memory:");
  initSchema(db);
  return { db, engine: new MnemosyneEngine(db) };
}

describe("Audit Part 2: session lifecycle, usage feedback, growth queue, conflicts, explanation", () => {
  test("1. Session lifecycle: writes inherit the session, ending it condenses and summarises the work", async () => {
    const { db, engine } = freshEngine();

    const session = engine.startSession({ goal: "wire hermes memory", cwd: "/home/dev/mnemosyne-qa" });
    expect(session.status).toBe("active");
    expect(session.project).toBe("mnemosyne-qa");

    const first = await engine.remember({ content: "Hermes session writes inherit the active session id" });
    const recalled = await engine.recall({ query: "Hermes session writes" });
    expect(recalled.memories.length).toBeGreaterThan(0);

    const linked = db.query("SELECT source_session FROM memories WHERE id = ?").get(first) as {
      source_session: string | null;
    };
    expect(linked.source_session).toBe(session.id);

    const ended = await engine.endSession({ outcome: "success" });
    expect(ended.session.status).toBe("ended");
    expect(ended.session.outcome).toBe("success");
    expect(ended.session.summary).toContain("wire hermes memory");
    expect(ended.session.recall_count).toBeGreaterThan(0);

    // The rollup condenses the session's micro-logs into one ledger memory.
    expect(ended.rolled_up).toBeGreaterThan(0);
    const ledger = db.query("SELECT structure_type, tags FROM memories WHERE id = ?").get(ended.macro_memory_id) as {
      structure_type: string;
      tags: string;
    };
    expect(ledger.structure_type).toBe("decision_ledger");
    expect(ledger.tags).toContain("#session-rollup");

    // A later session inherits the goal/summary of the previous one.
    engine.startSession({ goal: "follow-up work", cwd: "/home/dev/mnemosyne-qa" });
    const brief = engine.sessionBrief();
    expect(brief.markdown).toContain("Current Session");
    expect(brief.markdown).toContain("follow-up work");
    expect(brief.markdown).toContain("Previous Session");
    expect(brief.previous?.goal).toBe("wire hermes memory");
    expect(brief.guardrails_count).toBeGreaterThan(0);

    db.close();
  });

  test("2. Usage feedback: helped memories rank higher, misled ones sink", async () => {
    const { db, engine } = freshEngine();

    // Low importance keeps both scores below the 1.0 ceiling, so the feedback
    // multiplier is observable instead of being clipped away.
    const misled = await engine.remember({
      content: "Deploy the gateway through the legacy rsync script",
      category: "architecture",
      importance: "low",
    });
    const helped = await engine.remember({
      content: "Deploy the gateway through the Cloudflare Workers build",
      category: "architecture",
      importance: "low",
    });

    const scoreOf = async (id: string): Promise<number> => {
      const res = await engine.recall({ query: "deploy gateway workers rsync", limit: 5, min_relevance: 0 });
      return res.memories.find((m) => m.id === id)?.score ?? 0;
    };

    const misledBefore = await scoreOf(misled);
    const helpedBefore = await scoreOf(helped);

    engine.rate(misled, "misled", "wrong deploy path");
    engine.rate(misled, "misled");
    engine.rate(helped, "helped", "worked first try");
    engine.rate(helped, "helped");

    const misledAfter = await scoreOf(misled);
    const helpedAfter = await scoreOf(helped);

    expect(misledAfter).toBeLessThan(misledBefore);
    expect(helpedAfter).toBeGreaterThan(helpedBefore);
    expect(helpedAfter).toBeGreaterThan(misledAfter);

    const usage = engine.usage(misled)!;
    expect(usage.recalled).toBeGreaterThanOrEqual(2);
    expect(usage.misled).toBe(2);
    expect(usageMultiplier(usage)).toBeLessThan(1);
    expect(usageMultiplier(engine.usage(helped)!)).toBeGreaterThan(1);

    // Confidence follows the verdicts, so the signal survives re-scoring.
    const confidence = db.query("SELECT confidence FROM memories WHERE id = ?").get(misled) as { confidence: number };
    expect(confidence.confidence).toBeLessThan(1.0);

    db.close();
  });

  test("3. Candidate queue: guardrails promote themselves, borderline statements wait for review", async () => {
    const { db, engine } = freshEngine();
    const session = engine.startSession({ goal: "candidate queue", cwd: "/home/dev/qa-project" });

    // Guardrail wording scores high enough to go live immediately.
    const guardrail = await engine.ingest({
      content: "Jangan pernah jalankan build paralel di laptop RAM 16GB ini",
      session_id: session.id,
    });
    expect(guardrail.candidates?.promoted).toBe(1);
    expect(guardrail.candidates?.pending).toBe(0);
    const promoted = engine.candidates("promoted");
    expect(promoted.length).toBe(1);
    expect(promoted[0].promoted_memory_id).toBeTruthy();

    // Not a guardrail: staged, but the dreamer/review owns the promotion decision.
    const borderline = await engine.ingest({
      content: "Vahmi biasanya membuka dashboard telemetry setiap pagi",
      session_id: session.id,
    });
    expect(borderline.candidates?.stored).toBe(1);
    expect(borderline.candidates?.pending).toBe(1);
    expect(borderline.candidates?.promoted).toBe(0);

    const pending = engine.candidates("pending");
    expect(pending.length).toBe(1);
    expect(pending[0].triples.length).toBeGreaterThanOrEqual(0);
    expect(scoreCandidate(pending[0].content).confidence).toBeGreaterThanOrEqual(0.5);

    // Explicit review decisions.
    const approved = await engine.promoteCandidate(pending[0].id);
    expect(approved).toBeTruthy();
    expect((db.query("SELECT status FROM memory_candidates WHERE id = ?").get(pending[0].id) as { status: string }).status).toBe("promoted");

    const second = await engine.ingest({ content: "Vahmi suka mencatat error 401 di catatan harian", session_id: session.id });
    const secondId = second.candidates?.candidate_ids[0];
    if (secondId) {
      expect(engine.rejectCandidate(secondId)).toBe(true);
      expect((db.query("SELECT status FROM memory_candidates WHERE id = ?").get(secondId) as { status: string }).status).toBe("rejected");
    }

    db.close();
  });

  test("4. Cross-project promotion: recurring knowledge is proposed for global scope, then promoted", async () => {
    const { db, engine } = freshEngine();
    const memoryId = await engine.remember({
      content: "Always run database files through gitignore checks before commit",
      scope: "project",
      category: "rule",
    });

    // Only two projects so far: not enough evidence.
    engine.rate(memoryId, "helped", undefined);
    recordProjectHit(db, [memoryId], "project-a");
    recordProjectHit(db, [memoryId], "project-b");
    expect(engine.promotions(3).length).toBe(0);

    recordProjectHit(db, [memoryId], "project-c");
    const suggestions = engine.promotions(3);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].memory_id).toBe(memoryId);
    expect(suggestions[0].project_count).toBe(3);
    expect(suggestions[0].reason).toContain("project-a");

    expect(engine.promote(memoryId, "global")).toBe(true);
    const scope = db.query("SELECT scope FROM memories WHERE id = ?").get(memoryId) as { scope: string };
    expect(scope.scope).toBe("global");
    // Global scope drops out of the suggestion list.
    expect(engine.promotions(3).length).toBe(0);
    const events = db.query("SELECT event_type FROM memory_events WHERE memory_id = ?").all(memoryId) as Array<{ event_type: string }>;
    expect(events.some((e) => e.event_type === "MUTATED")).toBe(true);

    db.close();
  });

  test("5. Conflict preview reports duplicates, contradictions, single-value and multi-value writes", async () => {
    const { db, engine } = freshEngine();

    await engine.remember({ content: "Dek likes americano", category: "preference" });
    await engine.remember({ content: "Dek likes matcha", category: "preference" });
    await engine.remember({ content: "Albatross listens on 8787", category: "architecture" });

    const duplicate = await engine.conflicts("Dek likes americano");
    expect(duplicate.some((c) => c.kind === "duplicate")).toBe(true);

    const coexist = await engine.conflicts("Dek likes cold brew", { category: "preference" });
    expect(coexist.some((c) => c.kind === "multi_value_coexist")).toBe(true);
    expect(coexist.find((c) => c.kind === "multi_value_coexist")?.suggestion).toContain("multi-valued");

    const contradiction = await engine.conflicts("Dek dislikes americano", { category: "preference" });
    expect(contradiction.some((c) => c.kind === "contradiction")).toBe(true);

    const replacement = await engine.conflicts("Albatross listens on 9999", { category: "architecture" });
    expect(replacement.some((c) => c.kind === "single_value_replacement")).toBe(true);

    // A genuinely new statement conflicts with nothing.
    const clean = await engine.conflicts("Nginx terminates TLS for the staging cluster", { category: "architecture" });
    expect(clean.length).toBe(0);

    db.close();
  });

  test("6. Belief explanation: evidence chain with triples, abstention without support, contradictions surfaced", async () => {
    const { db, engine } = freshEngine();

    const supported = await engine.remember({
      content: "Albatross Gateway listens on 8787 and proxies agentrouter traffic",
      category: "architecture",
      importance: "high",
    });

    const explained = await engine.why("Albatross Gateway port");
    expect(explained.supported).toBe(true);
    expect(explained.confidence).toBeGreaterThan(0.35);
    expect(explained.evidence[0].memory_id).toBe(supported);
    expect(explained.evidence[0].triples.some((t) => t.predicate === "LISTENS_ON_PORT")).toBe(true);
    expect(explained.markdown).toContain("Evidence");

    // Abstention: nothing in memory supports this.
    const unknown = await engine.why("Quantum telemetry pipeline for the Mars colony");
    expect(unknown.supported).toBe(false);
    expect(unknown.confidence).toBe(0);
    expect(unknown.markdown).toContain("Do not assume");

    // Contradiction detection over live opposing triples.
    db.prepare(
      `INSERT INTO entity_triples (id, subject, predicate, object, memory_id, confidence, is_active, valid_from, created_at)
       VALUES (?, ?, ?, ?, ?, 1.0, 1, ?, ?)`
    ).run("qa-triple-likes", "Gateway", "LIKES", "8787", supported, Date.now(), Date.now());
    db.prepare(
      `INSERT INTO entity_triples (id, subject, predicate, object, memory_id, confidence, is_active, valid_from, created_at)
       VALUES (?, ?, ?, ?, ?, 1.0, 1, ?, ?)`
    ).run("qa-triple-dislikes", "Gateway", "DISLIKES", "8787", supported, Date.now(), Date.now());

    const conflicted = await engine.why("Gateway 8787");
    expect(conflicted.contradictions.length).toBeGreaterThanOrEqual(1);
    expect(conflicted.markdown).toContain("Conflicting beliefs");

    db.close();
  });

  test("7. Secrets are redacted before storage; ordinary text is left untouched", async () => {
    const { db, engine } = freshEngine();

    const clean = engine.scrub("Never run parallel builds on the 16GB laptop");
    expect(clean.redacted).toBe(0);
    expect(clean.text).toBe("Never run parallel builds on the 16GB laptop");

    const preview = engine.scrub("export GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123");
    expect(preview.redacted).toBeGreaterThan(0);
    expect(preview.text).not.toContain("ghp_");

    const id = await engine.remember({
      content: "Deploy hook uses sk-abcdefghijklmnopqrstuvwxyz123456 and Authorization: Bearer abcdef0123456789xyz",
      category: "architecture",
    });

    const stored = db.query("SELECT content FROM memories WHERE id = ?").get(id) as { content: string };
    expect(stored.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(stored.content).toContain("[REDACTED:");

    const note = db.query("SELECT content FROM notes ORDER BY id DESC LIMIT 1").get() as { content: string };
    expect(note.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");

    const ingested = await engine.ingest({ content: "JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart1234 leaked in logs" });
    expect(ingested.stored_in_notes).toBe(true);
    const noteTwo = db.query("SELECT content FROM notes ORDER BY id DESC LIMIT 1").get() as { content: string };
    expect(noteTwo.content).not.toContain("eyJhbGciOiJIUzI1NiJ9");

    db.close();
  });

  test("8. Entity canonicalization merges equal units into one graph node", async () => {
    const { db, engine } = freshEngine();

    await engine.remember({ content: "Build machine requires 16 GB RAM", category: "hardware" });
    await engine.remember({ content: "Build machine requires 16384MB RAM", category: "hardware" });

    const objects = db
      .query("SELECT DISTINCT object FROM entity_triples WHERE LOWER(subject) = 'build machine' AND predicate = 'REQUIRES'")
      .all() as Array<{ object: string }>;
    expect(objects.length).toBe(1);
    expect(objects[0].object.toLowerCase()).toBe("16gb ram");

    // Registered aliases are applied to graph entities as well.
    engine.addAlias("gw", "albatross-gateway");
    await engine.remember({ content: "gw requires 32GB RAM", category: "hardware" });
    const aliased = db
      .query("SELECT DISTINCT subject FROM entity_triples WHERE predicate = 'REQUIRES' AND LOWER(subject) = 'albatross-gateway'")
      .all() as Array<{ subject: string }>;
    expect(aliased.length).toBe(1);

    db.close();
  });
});

const PORT = 8878;
const DB_PATH = "/tmp/mnemo_qa_part2_rest.db";
const MCP_DB = "/tmp/mnemo_qa_part2_mcp.db";

async function waitForReady(proc: Subprocess<"pipe", "pipe">, needle: string): Promise<string> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return buffered;
    buffered += decoder.decode(value, { stream: true });
    if (buffered.includes(needle)) return buffered;
  }
}

describe("Audit Part 2: REST + MCP exposure of the new capabilities", () => {
  let server: Subprocess<"pipe", "pipe">;
  let banner = "";

  beforeAll(async () => {
    server = Bun.spawn(["bun", "src/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MNEMO_PORT: String(PORT),
        MNEMO_HOST: "127.0.0.1",
        MNEMO_DB_PATH: DB_PATH,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    banner = await waitForReady(server, "running on http://");
  });

  afterAll(() => {
    server?.kill();
    for (const base of [DB_PATH, MCP_DB]) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          rmSync(`${base}${suffix}`, { force: true });
        } catch {
          // nothing to remove
        }
      }
    }
  });

  test("9. REST endpoints expose sessions, feedback, conflicts, explanation and the candidate queue", async () => {
    expect(banner).toContain("running on http://");
    const base = `http://127.0.0.1:${PORT}`;
    const json = { "Content-Type": "application/json" };

    const started = await fetch(`${base}/v1/session/start`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ goal: "rest smoke", cwd: "/tmp/rest-project" }),
    });
    expect(started.status).toBe(200);
    const session = (await started.json()) as { session: { id: string; project: string } };
    expect(session.session.project).toBe("rest-project");

    const remembered = await fetch(`${base}/v1/memory/remember`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ content: "Rest smoke fact: gateway listens on 8787", category: "architecture" }),
    });
    const memory = (await remembered.json()) as { memory_id: string };
    expect(memory.memory_id).toBeTruthy();

    const feedback = await fetch(`${base}/v1/memory/feedback`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ memory_id: memory.memory_id, verdict: "helped", note: "rest check" }),
    });
    const feedbackBody = (await feedback.json()) as { success: boolean; usage: { helped: number } };
    expect(feedbackBody.success).toBe(true);
    expect(feedbackBody.usage.helped).toBe(1);

    const conflicts = await fetch(`${base}/v1/memory/conflicts`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ content: "Rest smoke fact: gateway listens on 8787" }),
    });
    const conflictBody = (await conflicts.json()) as { conflicts: Array<{ kind: string }> };
    expect(conflictBody.conflicts.some((c) => c.kind === "duplicate")).toBe(true);

    const why = await fetch(`${base}/v1/memory/why`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ claim: "gateway listens on 8787" }),
    });
    const whyBody = (await why.json()) as { explanation: { supported: boolean; markdown: string } };
    expect(whyBody.explanation.supported).toBe(true);
    expect(whyBody.explanation.markdown).toContain("Evidence");

    const candidatesRes = await fetch(`${base}/v1/candidates`);
    const candidatesBody = (await candidatesRes.json()) as { success: boolean };
    expect(candidatesBody.success).toBe(true);

    const promotionsRes = await fetch(`${base}/v1/memory/promotions?min_projects=1`);
    const promotionsBody = (await promotionsRes.json()) as { success: boolean; promotions: unknown[] };
    expect(promotionsBody.success).toBe(true);
    expect(Array.isArray(promotionsBody.promotions)).toBe(true);

    const brief = await fetch(`${base}/v1/session/brief`);
    const briefBody = (await brief.json()) as { brief: { markdown: string } };
    expect(briefBody.brief.markdown).toContain("Current Session");

    const ended = await fetch(`${base}/v1/session/end`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ outcome: "success" }),
    });
    const endedBody = (await ended.json()) as { success: boolean; session: { status: string } };
    expect(endedBody.success).toBe(true);
    expect(endedBody.session.status).toBe("ended");

    const sessions = await fetch(`${base}/v1/sessions`);
    const sessionsBody = (await sessions.json()) as { sessions: Array<{ id: string }>; active: unknown };
    expect(sessionsBody.sessions.length).toBeGreaterThan(0);
    expect(sessionsBody.active).toBeNull();
  });

  test("10. MCP exposes the new tools and answers tools/list", async () => {
    const proc = Bun.spawn(["bun", "src/mcp.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, MNEMO_DB_PATH: MCP_DB },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) + "\n");
    await proc.stdin.end();

    const stdout = await new Response(proc.stdout).text();
    proc.kill();

    const line = stdout.split("\n").find((l) => l.includes('"tools"'));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line ?? "{}") as { result?: { tools?: Array<{ name: string }> } };
    const names = (parsed.result?.tools ?? []).map((t) => t.name);

    for (const tool of [
      "session_start",
      "session_end",
      "session_brief",
      "rate_memory",
      "list_candidates",
      "promote_candidate",
      "list_promotions",
      "promote_memory",
      "check_conflicts",
      "explain_belief",
    ]) {
      expect(names).toContain(tool);
    }
  });
});
