import type { Database } from "bun:sqlite";
import { askPeer } from "../engine/insights.ts";
import { LlmClient } from "../engine/llm.ts";
import { ingestMessages, type MessageInput } from "../engine/messages.ts";
import { getRepresentation } from "../engine/representation.ts";

/**
 * MCP tools for the personal-memory layer. The MCP process only queues
 * messages; the daemon's deriver (or `mnemo derive --once`) processes them.
 */
export const PEER_MCP_TOOLS = [
  {
    name: "ingest_messages",
    description:
      "Append raw conversation messages to personal memory. They are queued and learned from in the background (facts, preferences, goals) — no LLM call happens here.",
    inputSchema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              peer: { type: "string", description: "Who the memory is about (default 'user')." },
              session: { type: "string" },
              role: { type: "string", enum: ["user", "assistant"] },
              content: { type: "string" },
              ts: { type: "number", description: "Unix ms timestamp (keeps retries idempotent)." },
            },
            required: ["content"],
          },
        },
      },
      required: ["messages"],
    },
  },
  {
    name: "ask_about_user",
    description:
      "Ask a natural-language question about the user. Answers only from learned memory, cites memory ids, and says it doesn't know when memory lacks the answer.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        peer: { type: "string", description: "Default 'user'." },
        depth: { type: "number", description: "1 = answer, 2 = + self-audit, 3 = + reconciliation (default 1)." },
      },
      required: ["question"],
    },
  },
  {
    name: "get_user_representation",
    description: "Return the living summary and peer card (stable, trusted facts) for the user.",
    inputSchema: { type: "object", properties: { peer: { type: "string" } } },
  },
];

const text = (t: string) => ({ content: [{ type: "text", text: t }] });

/** Returns an MCP result, or null when the tool name is not one of ours. */
export async function callPeerTool(db: Database, name: string, args: any, llmFactory: () => LlmClient | null = () => LlmClient.fromEnv()) {
  if (name === "ingest_messages") {
    const list: MessageInput[] = (Array.isArray(args?.messages) ? args.messages : []).map((m: any) => ({ ...m, peer: m?.peer || "user" }));
    if (list.length === 0) throw new Error("messages must be a non-empty array");
    const res = ingestMessages(db, list);
    return text(`Queued ${res.ingested} message(s) (${res.duplicates} duplicate, ${res.skipped} empty). The deriver learns from them in the background.`);
  }
  if (name === "ask_about_user") {
    if (typeof args?.question !== "string" || !args.question.trim()) throw new Error("question is required");
    const res = await askPeer(db, llmFactory(), args.peer || "user", args.question, { depth: Number(args.depth) || 1 });
    const cites = res.citations.map((c) => `- [${c.id}] ${c.content}`).join("\n");
    return { ...text(res.abstained ? `${res.answer}${cites ? `\n\nClosest memories:\n${cites}` : ""}` : `${res.answer}\n\nSources:\n${cites}`), structuredContent: res };
  }
  if (name === "get_user_representation") {
    const rep = getRepresentation(db, args?.peer || "user");
    const body = `${rep.summary || "(no summary yet)"}\n\nPeer card:\n${rep.card.map((c) => `- ${c}`).join("\n") || "(empty)"}`;
    return { ...text(body), structuredContent: rep };
  }
  return null;
}
