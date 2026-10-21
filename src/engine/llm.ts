import { CONFIG } from "../config.ts";

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

export function resolveChatUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LlmClient {
  readonly url: string;
  readonly model: string;
  private apiKey: string;
  private timeoutMs: number;
  private minIntervalMs: number;
  private maxRetries: number;
  private backoffMs: number;
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
  }

  /** Reads MNEMO_LLM_* at call time. Returns null when no endpoint was configured. */
  static fromEnv(): LlmClient | null {
    const explicit = process.env.MNEMO_LLM_URL;
    if (!explicit && !CONFIG.LLM_ENABLED) return null;
    return new LlmClient({
      url: explicit || CONFIG.LLM_URL,
      apiKey: process.env.MNEMO_LLM_KEY || CONFIG.LLM_API_KEY,
      model: process.env.MNEMO_LLM_MODEL || CONFIG.LLM_MODEL,
      timeoutMs: CONFIG.LLM_TIMEOUT_MS,
      rpm: CONFIG.LLM_RPM,
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

  private async once(messages: ChatMessage[], opts: { json?: boolean; temperature?: number; maxTokens?: number }): Promise<string> {
    const useJson = Boolean(opts.json) && this.jsonModeSupported;
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.1,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (useJson) body.response_format = { type: "json_object" };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new LlmError(`llm endpoint unreachable: ${(err as Error).message}`, true);
    }

    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 400 && useJson && /response_format|json/i.test(text)) {
        this.jsonModeSupported = false;
        return this.once(messages, opts);
      }
      const retryable = res.status === 429 || res.status >= 500 || res.status === 408;
      throw new LlmError(`llm http ${res.status}: ${text}`, retryable, res.status);
    }

    const data = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new LlmError("llm reply had no choices[0].message.content", true);
    return content;
  }

  async chatJSON<T = any>(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<T> {
    const text = await this.chat(messages, { ...opts, json: true });
    return parseJsonReply(text) as T;
  }
}
