/**
 * Mock OpenAI-compatible server for tests (no real network).
 * Routes /v1/chat/completions by the system prompt's intent to a scripted handler,
 * and serves /v1/embeddings with a tiny deterministic vector.
 */
export type Intent = "extract" | "decide" | "summary" | "ask" | "audit" | "reconcile" | "reflect" | "unknown";

export interface MockCall {
  intent: Intent;
  body: any;
  system: string;
  user: string;
  auth: string | null;
}

export type Handler = (call: MockCall) => any;

export function intentOf(system: string): Intent {
  if (system.includes("You extract durable knowledge")) return "extract";
  if (system.includes("maintain a memory of facts")) return "decide";
  if (system.includes("living profile")) return "summary";
  if (system.includes("You audit a draft")) return "audit";
  if (system.includes("You reconcile")) return "reconcile";
  if (system.includes("You answer questions")) return "ask";
  if (system.includes("You reflect over facts")) return "reflect";
  return "unknown";
}

/** JSON-lines transcript ({"id":12,"session":"s1","speaker":"alice","role":"user","text":"..."}) -> [{id, text, role}] */
export function parseTranscript(user: string): Array<{ id: number; text: string; role: string }> {
  const out: Array<{ id: number; text: string; role: string }> = [];
  for (const line of user.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const m = JSON.parse(line);
      if (typeof m?.id === "number" && typeof m?.text === "string") out.push({ id: m.id, text: m.text, role: String(m.role) });
    } catch {
      // not a transcript line
    }
  }
  return out;
}

/** Pulls "id=<uuid>" tokens in order of appearance. */
export function idsIn(text: string): string[] {
  return Array.from(text.matchAll(/id=([0-9a-f-]{36})/g)).map((m) => m[1]);
}

export class MockOpenAI {
  calls: MockCall[] = [];
  handlers: Partial<Record<Intent, Handler>> = {};
  /** When > 0, the next N chat requests return this HTTP status. */
  failNext = 0;
  failStatus = 503;
  rejectJsonMode = false;
  embedCalls = 0;
  private server: ReturnType<typeof Bun.serve>;

  constructor() {
    this.server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        const url = new URL(req.url);
        const body = (await req.json().catch(() => ({}))) as any;
        if (url.pathname.endsWith("/embeddings")) {
          this.embedCalls++;
          return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] }] });
        }
        if (!url.pathname.endsWith("/chat/completions")) return new Response("nope", { status: 404 });
        if (this.rejectJsonMode && body.response_format) {
          return new Response(JSON.stringify({ error: "response_format not supported" }), { status: 400 });
        }
        if (this.failNext > 0) {
          this.failNext--;
          return new Response("upstream down", { status: this.failStatus });
        }
        const system = String(body.messages?.find((m: any) => m.role === "system")?.content ?? "");
        const user = String(body.messages?.find((m: any) => m.role === "user")?.content ?? "");
        const call: MockCall = { intent: intentOf(system), body, system, user, auth: req.headers.get("authorization") };
        this.calls.push(call);
        const handler = this.handlers[call.intent];
        const reply = handler ? handler(call) : defaultReply(call);
        return Response.json({ choices: [{ message: { role: "assistant", content: typeof reply === "string" ? reply : JSON.stringify(reply) } }] });
      },
    });
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.server.port}/v1`;
  }

  callsOf(intent: Intent): MockCall[] {
    return this.calls.filter((c) => c.intent === intent);
  }

  reset(): void {
    this.calls = [];
    this.handlers = {};
    this.failNext = 0;
    this.rejectJsonMode = false;
  }

  stop(): void {
    this.server.stop(true);
  }
}

function defaultReply(call: MockCall): any {
  switch (call.intent) {
    case "extract":
      return { facts: [], session_summaries: {} };
    case "decide":
      return { decisions: [] };
    case "summary":
      return { summary: "Mock summary." };
    case "reflect":
      return { insights: [] };
    default:
      return { answer: "", citations: [], abstain: true };
  }
}
