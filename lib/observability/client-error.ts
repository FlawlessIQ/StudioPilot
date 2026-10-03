/**
 * What a browser error report may carry, and how it is cleaned.
 *
 * Shared by the reporter (components/observability/error-reporter.tsx), which
 * cleans before sending, and by the route (app/api/client-errors/route.ts),
 * which cleans again because it cannot trust what arrives. Browser-safe: no
 * Node or Next imports.
 *
 * "No personal data" in practice means three things an error message or stack
 * picks up without anyone meaning it to: an email address (a couple's, typed
 * into a form whose validation threw), a query string (`?project=…&email=…`),
 * and a capability token in a path (`/i/<token>`, `/d/<token>` — the link *is*
 * the access). All three are removed before anything is logged.
 */

export const CLIENT_ERROR_LIMITS = {
  /** The request body, in bytes. */
  body: 16 * 1024,
  message: 1000,
  name: 120,
  stack: 4000,
  route: 300,
  userAgent: 300,
} as const;

export type ClientErrorReport = {
  message: string;
  name: string;
  stack: string;
  route: string;
  userAgent: string;
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// A query string or fragment on anything URL- or path-like. Stops at the
// characters that end a URL in a stack line: whitespace, quotes, brackets, and
// the `:line:col` suffix is kept by stopping at the closing paren.
const QUERY = /\?[^\s"'`()<>]*/g;
const FRAGMENT = /(\/[^\s"'`()<>#]*)#[^\s"'`()<>]*/g;
// A path segment that looks like a token: long, with a digit in it (so a long
// readable slug such as `/integration-diagnostics` survives). Chunk hashes
// (`/_next/static/chunks/abc123.js`) are kept: the dot ends no match.
const TOKEN_SEGMENT = /\/[A-Za-z0-9_-]{20,}(?=[/\s"'`()<>:]|$)/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;

const text = (value: unknown, limit: number): string =>
  typeof value === "string" ? value.slice(0, limit) : "";

/** Remove emails, query strings, fragments and token-like path segments. */
export function scrubClientErrorText(value: string): string {
  return value
    .replace(JWT, "[token]")
    .replace(EMAIL, "[email]")
    .replace(QUERY, "")
    .replace(FRAGMENT, "$1")
    .replace(TOKEN_SEGMENT, (segment) => (/\d/.test(segment) ? "/[token]" : segment));
}

/** The pathname alone: no origin, no query, no fragment, no tokens. */
export function scrubRoute(value: string): string {
  let pathname = value;
  try {
    pathname = new URL(value, "https://studiocue.invalid").pathname;
  } catch {
    pathname = value.split(/[?#]/)[0] ?? "";
  }
  return scrubClientErrorText(pathname).slice(0, CLIENT_ERROR_LIMITS.route) || "/";
}

/**
 * A report fit to log, from whatever arrived. Unknown fields are dropped;
 * every field is bounded and scrubbed. `null` when there is nothing to report.
 */
export function sanitizeClientErrorReport(input: unknown): ClientErrorReport | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const message = scrubClientErrorText(text(raw.message, CLIENT_ERROR_LIMITS.message * 2)).slice(
    0,
    CLIENT_ERROR_LIMITS.message,
  );
  const stack = scrubClientErrorText(text(raw.stack, CLIENT_ERROR_LIMITS.stack * 2)).slice(
    0,
    CLIENT_ERROR_LIMITS.stack,
  );
  if (!message && !stack) return null;
  return {
    message,
    name: scrubClientErrorText(text(raw.name, CLIENT_ERROR_LIMITS.name)) || "Error",
    stack,
    route: scrubRoute(text(raw.route, CLIENT_ERROR_LIMITS.route * 2)),
    userAgent: text(raw.userAgent, CLIENT_ERROR_LIMITS.userAgent),
  };
}
