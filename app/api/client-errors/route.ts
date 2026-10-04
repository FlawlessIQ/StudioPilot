import {
  CLIENT_ERROR_LIMITS,
  sanitizeClientErrorReport,
} from "@/lib/observability/client-error";
import { requestClientIp } from "@/lib/security/client-ip";

/**
 * Browser errors, recorded at ERROR in Cloud Logging.
 *
 * Without a Sentry DSN the reporter used to do nothing, so a page that threw
 * in a studio's browser left no trace anywhere. The reporter now posts here
 * (components/observability/error-reporter.tsx) and this writes one structured
 * line that Cloud Logging reads as severity ERROR, which a log-based alert can
 * count.
 *
 * Unauthenticated by necessity — the error may be the sign-in page's — so it
 * is bounded three ways: a body cap, a per-address rate limit, and a scrub of
 * every field (lib/observability/client-error.ts). The address is used only
 * for the limit and never logged.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const MAX_TRACKED_ADDRESSES = 5_000;
const recent = new Map<string, { count: number; resetAt: number }>();

function clientAddress(request: Request): string {
  return (
    requestClientIp(request) ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function rateLimited(address: string, now: number): boolean {
  if (recent.size > MAX_TRACKED_ADDRESSES) {
    for (const [key, entry] of recent) if (entry.resetAt <= now) recent.delete(key);
    if (recent.size > MAX_TRACKED_ADDRESSES) recent.clear();
  }
  const entry = recent.get(address);
  if (!entry || entry.resetAt <= now) {
    recent.set(address, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

const empty = (status: number) => new Response(null, { status });

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > CLIENT_ERROR_LIMITS.body) return empty(413);
  if (rateLimited(clientAddress(request), Date.now())) return empty(429);

  let body: string;
  try {
    body = await request.text();
  } catch {
    return empty(400);
  }
  if (new TextEncoder().encode(body).byteLength > CLIENT_ERROR_LIMITS.body) return empty(413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return empty(400);
  }
  const report = sanitizeClientErrorReport(parsed);
  if (!report) return empty(400);

  console.error(
    JSON.stringify({
      severity: "ERROR",
      message: "client_error",
      error: { name: report.name, message: report.message, stack: report.stack },
      route: report.route,
      userAgent: report.userAgent,
    }),
  );
  return empty(204);
}
