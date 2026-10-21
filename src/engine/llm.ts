import { CONFIG } from "../config.ts";
import { redactSecrets } from "./redact.ts";

/**
 * Minimal client for any OpenAI-compatible Chat Completions endpoint
 * (OpenRouter, Ollama /v1, vLLM, LiteLLM, LM Studio, OpenAI...).
 *
 * - Accepts a base URL (".../v1") or the full ".../chat/completions" URL.
 * - Asks for JSON mode; falls back to a plain request when the server rejects
 *   `response_format` (some local servers / models do).
 * - Per-call retry with exponential backoff on network errors, 429 and 5xx.
 * - Process-wide pacing per client instance (requests-per-minute).
 */
export interface LlmOptions {
  url: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  rpm?: number;
  maxRetries?: number;
  /** Base backoff in ms (tests shrink it). */
  backoffMs?: number;
  /**
   * Default completion cap sent as max_tokens. Without it OpenRouter-style
   * gateways reserve the model's full context and reject credit-limited keys
   * with HTTP 402 before the model runs.
   */
  maxTokens?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class LlmError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * The model stopped at max_tokens and the JSON it produced is incomplete. Retrying the
 * same request reproduces it, so callers must shrink the input (the deriver halves the
 * batch) instead of retrying or poisoning the queue.
 */
export class LlmTruncatedError extends LlmError {
  constructor(message: string) {
    super(message, false);
    this.name = "LlmTruncatedError";
  }
}

/** Only http(s) endpoints: Bun's fetch also speaks file:// and data:, which must never be an "LLM". */
export function assertHttpUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new LlmError("llm url is not a valid URL", false);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new LlmError(`llm url must be http(s), got ${u.protocol}`, false);
}

export function resolveChatUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  assertHttpUrl(trimmed);
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

/** URL safe to display: drops userinfo, query and fragment (keys sometimes ride there). */
export function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

/** Pulls the first JSON object out of a model reply (tolerates ```json fences and chatter). */
export function parseJsonReply(text: string): any {
  const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new LlmError("model reply was not valid JSON", true);
  }
}

let cachedClient: { sig: string; client: LlmClient } | null = null;
let warnedSig: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LlmClient {
  readonly url: string;
  readonly model: string;
  private apiKey: string;
  private timeoutMs: number;
  private minIntervalMs: number;
  private maxRetries: number;
  private backoffMs: number;
  private maxTokens: number;
  private nextSlot = 0;
  private jsonModeSupported = true;

  constructor(opts: LlmOptions) {
    this.url = resolveChatUrl(opts.url);
    this.model = opts.model;
    this.apiKey = opts.apiKey || "";
    this.timeoutMs = opts.timeoutMs ?? 60000;
    this.minIntervalMs = opts.rpm && opts.rpm > 0 ? Math.ceil(60000 / opts.rpm) : 0;
    this.maxRetries = opts.maxRetries ?? 2;
    this.backoffMs = opts.backoffMs ?? 500;
    this.maxTokens = opts.maxTokens && opts.maxTokens > 0 ? Math.trunc(opts.maxTokens) : 2048;
  }

  /** Reads MNEMO_LLM_* at call time. Returns null when no endpoint was configured. */
  static fromEnv(): LlmClient | null {
    const explicit = process.env.MNEMO_LLM_URL;
    if (!explicit && !CONFIG.LLM_ENABLED) return null;
    // Reuse one client per configuration so RPM pacing and the JSON-mode probe
    // survive across deriver ticks (a fresh client per tick reset both).
    const sig = [explicit || CONFIG.LLM_URL, process.env.MNEMO_LLM_KEY || CONFIG.LLM_API_KEY, process.env.MNEMO_LLM_MODEL || CONFIG.LLM_MODEL].join("\u0000");
    if (cachedClient && cachedClient.sig === sig) return cachedClient.client;
    try {
      const client = LlmClient.build();
      cachedClient = { sig, client };
      return client;
    } catch (err) {
      if (warnedSig !== sig) console.warn(`[mnemo] LLM disabled: ${(err as Error).message}`);
      warnedSig = sig;
      return null;
    }
  }

  private static build(): LlmClient {
    const explicit = process.env.MNEMO_LLM_URL;
    return new LlmClient({
      url: explicit || CONFIG.LLM_URL,
      apiKey: process.env.MNEMO_LLM_KEY || CONFIG.LLM_API_KEY,
      model: process.env.MNEMO_LLM_MODEL || CONFIG.LLM_MODEL,
      timeoutMs: CONFIG.LLM_TIMEOUT_MS,
      rpm: CONFIG.LLM_RPM,
      maxTokens: CONFIG.LLM_MAX_TOKENS,
    });
  }

  describe(): { url: string; model: string } {
    return { url: displayUrl(this.url), model: this.model };
  }

  private async pace(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    if (slot > now) await sleep(slot - now);
  }

  async chat(messages: ChatMessage[], opts: { json?: boolean; temperature?: number; maxTokens?: number } = {}): Promise<string> {
    return (await this.chatRaw(messages, opts)).content;
  }

  private async chatRaw(messages: ChatMessage[], opts: { json?: boolean; temperature?: number; maxTokens?: number }): Promise<{ content: string; finish: string | null }> {
    let lastErr: LlmError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const jitter = Math.random() * this.backoffMs;
        await sleep(this.backoffMs * 2 ** (attempt - 1) + jitter);
      }
      await this.pace();
      try {
        return await this.once(messages, opts);
      } catch (err) {
        lastErr = err instanceof LlmError ? err : new LlmError(String((err as Error)?.message ?? err), true);
        if (!lastErr.retryable) throw lastErr;
      }
    }
    throw lastErr ?? new LlmError("unknown llm failure", true);
  }

  private async once(messages: ChatMessage[], opts: { json?: boolean; temperature?: number; maxTokens?: number }): Promise<{ content: string; finish: string | null }> {
    const useJson = Boolean(opts.json) && this.jsonModeSupported;
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.1,
    };
    body.max_tokens = opts.maxTokens && opts.maxTokens > 0 ? Math.trunc(opts.maxTokens) : this.maxTokens;
    if (useJson) body.response_format = { type: "json_object" };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        // Never follow redirects: a hijacked/misconfigured endpoint must not bounce the
        // request (and its Authorization header) somewhere else.
        redirect: "error",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new LlmError(`llm endpoint unreachable: ${redactSecrets(String((err as Error)?.message ?? err)).text.slice(0, 200)}`, true);
    }

    if (!res.ok) {
      // Error bodies end up in deriver status / dashboard: some gateways echo the key back.
      const text = redactSecrets((await res.text().catch(() => "")).slice(0, 2000)).text.slice(0, 300);
      if (res.status === 400 && useJson && /response_format|json/i.test(text)) {
        this.jsonModeSupported = false;
        return this.once(messages, opts);
      }
      // OpenRouter answers 402 "in_flight_budget_exhausted" when concurrent requests briefly
      // reserve the key's remaining budget: that one clears on its own, unlike "out of credits".
      const transient402 = res.status === 402 && /in_flight|retry after/i.test(text);
      const retryable = res.status === 429 || res.status >= 500 || res.status === 408 || transient402;
      throw new LlmError(`llm http ${res.status}: ${text}`, retryable, res.status);
    }

    const data = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new LlmError("llm reply had no choices[0].message.content", true);
    const finish = data?.choices?.[0]?.finish_reason;
    return { content, finish: typeof finish === "string" ? finish : null };
  }

  async chatJSON<T = any>(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<T> {
    const { content, finish } = await this.chatRaw(messages, { ...opts, json: true });
    try {
      return parseJsonReply(content) as T;
    } catch (err) {
      if (finish && /^(length|max_tokens)$/i.test(finish)) {
        throw new LlmTruncatedError(`model reply truncated at max_tokens (${finish}); JSON incomplete`);
      }
      throw err;
    }
  }
}
