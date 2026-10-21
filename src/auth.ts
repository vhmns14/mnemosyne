/**
 * Optional token authentication for the local REST daemon.
 *
 * Accepted carriers: `Authorization: Bearer <token>`, `X-Mnemosyne-Key`, or the
 * HttpOnly session cookie written by POST /v1/auth/session.
 *
 * Query-string tokens (`?token=`) are deliberately NOT accepted — URLs leak into
 * access logs, shell history and Referer headers. The cookie exists so clients that
 * cannot set headers (EventSource) still authenticate without exposing the token.
 */

import { timingSafeEqual, createHash } from "node:crypto";

export const AUTH_COOKIE = "mnemo_token";

const PUBLIC_PATHS: Record<string, true> = {
  "/": true,
  "/dashboard": true,
  "/health": true,
  "/v1/health": true,
  // Verifies the token itself, so it cannot require one to be presented.
  "/v1/auth/session": true,
};

/**
 * Every route except the public shell needs the token when one is configured.
 * (It used to be "/v1/* only", which left the legacy aliases /ingest, /recall,
 * /card, /stats, /dream and /events wide open.)
 */
export function requiresAuth(pathname: string): boolean {
  return PUBLIC_PATHS[pathname] !== true;
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

export function extractToken(req: Request): string | null {
  const header = req.headers.get("authorization") || req.headers.get("x-mnemosyne-key");
  if (header) return header.replace(/^Bearer\s+/i, "").trim();
  return parseCookies(req.headers.get("cookie"))[AUTH_COOKIE] ?? null;
}

/** Constant-time comparison (hash first so lengths never leak either). */
export function tokenMatches(provided: string | null | undefined, expected: string): boolean {
  if (typeof provided !== "string" || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function isAuthorized(req: Request, expectedToken: string): boolean {
  return tokenMatches(extractToken(req), expectedToken);
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase()) || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Host part of a Host header ("127.0.0.1:8788" -> "127.0.0.1", "[::1]:8788" -> "[::1]"). */
export function hostOnly(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  const colon = h.lastIndexOf(":");
  return colon > -1 ? h.slice(0, colon) : h;
}

export interface GateOptions {
  token?: string;
  /** Extra Host values accepted besides loopback (MNEMO_ALLOWED_HOSTS, the bind host). */
  allowedHosts?: string[];
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Request gate run before any route. Returns a Response to send, or null to continue.
 *
 *  - Host allow-list (DNS rebinding: evil.example resolving to 127.0.0.1 must not
 *    get same-origin access to the API).
 *  - Browser cross-site requests are refused (Origin must be a loopback origin,
 *    Sec-Fetch-Site must not be cross-site except a top-level dashboard navigation).
 *  - State-changing requests with a body must be JSON (an HTML form can only send
 *    urlencoded/multipart/text-plain, so classic CSRF cannot reach a handler).
 *  - Token auth on every non-public route when a token is configured.
 */
export function securityGate(req: Request, url: URL, opts: GateOptions = {}): Response | null {
  const json = (status: number, error: string) => Response.json({ success: false, error }, { status });
  const host = hostOnly(req.headers.get("host") || url.host);
  const allowed = new Set((opts.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean));
  if (!isLoopbackHost(host) && !allowed.has(host)) {
    return json(421, "Misdirected Request: unknown Host header (set MNEMO_ALLOWED_HOSTS to allow it).");
  }

  const origin = req.headers.get("origin");
  if (origin) {
    let ok = false;
    try {
      const o = new URL(origin);
      ok = (o.protocol === "http:" || o.protocol === "https:") && (isLoopbackHost(o.hostname) || allowed.has(o.hostname.toLowerCase()));
    } catch {
      ok = false;
    }
    if (!ok) return new Response("CORS Forbidden: External web domains cannot access local memory daemon.", { status: 403 });
  }

  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") {
    const isNavigation =
      (req.method === "GET" || req.method === "HEAD") &&
      req.headers.get("sec-fetch-mode") === "navigate" &&
      (url.pathname === "/" || url.pathname === "/dashboard");
    if (!isNavigation) return json(403, "Forbidden: cross-site request.");
  }

  // CORS preflight carries no credentials by design; it only gets CORS headers.
  if (req.method === "OPTIONS") return null;

  if (STATE_CHANGING.has(req.method)) {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    const hasBody = req.headers.get("content-length") !== null && req.headers.get("content-length") !== "0";
    const chunked = (req.headers.get("transfer-encoding") || "").toLowerCase().includes("chunked");
    if ((ct && !/^application\/(?:[a-z0-9.+-]+\+)?json\b/.test(ct)) || (!ct && (hasBody || chunked))) {
      return json(415, "Unsupported Media Type: send Content-Type: application/json.");
    }
  }

  if (opts.token && requiresAuth(url.pathname) && !isAuthorized(req, opts.token)) {
    return json(401, "Unauthorized: Invalid or missing authentication token.");
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`;
}

export function clearSessionCookie(): string {
  return `${AUTH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
