import type { Database } from "bun:sqlite";
import { runDeriverOnce, deriverStatus } from "../engine/deriver.ts";
import { listFacts } from "../engine/facts.ts";
import { askPeer, reflectPeer } from "../engine/insights.ts";
import { LlmClient } from "../engine/llm.ts";
import { ingestMessages } from "../engine/messages.ts";
import { getRepresentation, refreshRepresentation } from "../engine/representation.ts";

export const PEER_HELP = `
PERSONAL MEMORY (learns from conversations; LLM via MNEMO_LLM_URL / MNEMO_LLM_KEY / MNEMO_LLM_MODEL):
  serve                 Start the REST daemon + dashboard + background deriver (http://127.0.0.1:8788/)
  ingest <content>      Also queues the text as a raw message for the deriver (--peer, --session, --role)
  derive --once         Process queued messages now (extract facts, dedupe, supersede, refresh profile)
  derive --status       Show queue size, last run, last error, LLM endpoint/model
  profile [--peer p]    Living summary + peer card (falls back to the classic persona when empty)
  facts [query]         List derived facts with confidence, trust, category (--peer, -c category)
  ask "<question>"      Answer from memory with cited memory ids, or abstain (--peer, --depth 1-3)
  reflect               With no topic: synthesize cross-memory insights for the peer (--peer)
`;

type Values = Record<string, any>;

function llmOrWarn(): LlmClient | null {
  const llm = LlmClient.fromEnv();
  if (!llm) console.error("⚠ No LLM configured. Set MNEMO_LLM_URL (e.g. https://openrouter.ai/api/v1 or http://localhost:11434/v1).");
  return llm;
}

/** Returns true when the command was handled here. */
export async function runPeerCli(db: Database, command: string, positionals: string[], values: Values): Promise<boolean> {
  const text = positionals.join(" ").trim();
  const peer: string = values.peer || "user";

  switch (command) {
    case "serve": {
      await import("../server.ts");
      return true;
    }
    case "derive": {
      if (values.status) {
        console.log(JSON.stringify(deriverStatus(db, LlmClient.fromEnv()), null, 2));
        return true;
      }
      const llm = llmOrWarn();
      const res = await runDeriverOnce(db, llm, { maxBatches: values.once ? 10 : 1000 });
      const totals = res.batches.reduce(
        (a, b) => ({ messages: a.messages + b.messages, added: a.added + b.added, updated: a.updated + b.updated, deleted: a.deleted + b.deleted, noop: a.noop + b.noop }),
        { messages: 0, added: 0, updated: 0, deleted: 0, noop: 0 }
      );
      console.log(
        `derive: ${res.batches.length} batch(es), ${totals.messages} message(s) → +${totals.added} added, ${totals.updated} updated, ${totals.deleted} superseded, ${totals.noop} already known`
      );
      if (res.skipped_reason) console.log(`skipped: ${res.skipped_reason}`);
      if (res.error) {
        console.error(`error: ${res.error} (batch re-queued with backoff)`);
        process.exitCode = 1;
      }
      return true;
    }
    case "ask": {
      if (!text) {
        console.error('Usage: mnemo ask "<question>" [--peer user] [--depth 1-3]');
        process.exitCode = 1;
        return true;
      }
      const res = await askPeer(db, llmOrWarn(), peer, text, { depth: Number(values.depth) || 1 });
      if (values.json) {
        console.log(JSON.stringify(res, null, 2));
        return true;
      }
      console.log(`\n${res.answer}\n`);
      for (const c of res.citations) console.log(`  [${c.id}] ${c.content}`);
      console.log("");
      return true;
    }
    case "profile": {
      let rep = getRepresentation(db, peer);
      if (rep.fact_count === 0 && !rep.pinned) return false; // classic persona view
      if (values.refresh) rep = await refreshRepresentation(db, peer, LlmClient.fromEnv());
      if (values.json) {
        console.log(JSON.stringify(rep, null, 2));
        return true;
      }
      console.log(`\n${peer} — ${rep.fact_count} fact(s)${rep.updated_at ? `, updated ${new Date(rep.updated_at).toISOString()}` : ""}`);
      console.log("─".repeat(60));
      console.log(rep.summary || "(summary not generated yet — run `mnemo derive --once` or `mnemo profile --refresh`)");
      console.log("\nPeer card:");
      for (const c of rep.card) console.log(`  • ${c}`);
      console.log("");
      return true;
    }
    case "facts": {
      const facts = listFacts(db, peer, { q: text || undefined, category: values.category, limit: Number(values.limit) || 50 });
      for (const f of facts) {
        console.log(`${f.id}  [${f.category}/${f.kind}] conf ${f.confidence.toFixed(2)} trust ${f.trust.toFixed(2)}  ${f.content}`);
      }
      if (facts.length === 0) console.log("(no facts)");
      return true;
    }
    case "reflect": {
      if (text) return false; // classic topic reflection
      const res = await reflectPeer(db, peer, llmOrWarn());
      if (res.skipped_reason) console.log(`skipped: ${res.skipped_reason}`);
      for (const i of res.insights) console.log(`• ${i.content}\n  from ${i.source_memory_ids.join(", ")}`);
      if (!res.skipped_reason && res.insights.length === 0) console.log("No new insights.");
      return true;
    }
    default:
      return false;
  }
}

/** `mnemo ingest` keeps its classic behaviour and additionally queues the raw message. */
export function queueCliMessage(db: Database, content: string, values: Values): number {
  if (values.fact) return 0;
  return ingestMessages(db, [{ peer: values.peer || "user", session: values.session || "cli", role: values.role || "user", content, source: "cli" }]).ingested;
}

