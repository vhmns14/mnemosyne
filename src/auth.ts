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

export const AUTH_COOKIE = "mnemo_token";

const PUBLIC_PATHS: Record<string, true> = {
  "/": true,
  "/dashboard": true,
  "/health": true,
  "/v1/health": true,
  // Verifies the token itself, so it cannot require one to be presented.
  "/v1/auth/session": true,
};

export function requiresAuth(pathname: string): boolean {
  return pathname.startsWith("/v1/") && PUBLIC_PATHS[pathname] !== true;
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

export function isAuthorized(req: Request, expectedToken: string): boolean {
  const provided = extractToken(req);
  return provided !== null && provided === expectedToken;
}

export function sessionCookie(token: string): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`;
}

export function clearSessionCookie(): string {
  return `${AUTH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
