import { createHash } from "node:crypto";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import type { Request } from "firebase-functions/v2/https";

export async function requireAppCheck(request: Request): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR === "true") return;
  const token = request.header("x-firebase-appcheck");
  if (!token) throw new Error("APP_CHECK_REQUIRED");
  await getAppCheck().verifyToken(token);
}

export async function requireAppCheckOrAppHostingProxy(
  request: Request,
): Promise<void> {
  if (request.header("x-studiohub-proxy") === "app-hosting") return;
  await requireAppCheck(request);
}

export async function requireIdentity(request: Request): Promise<DecodedIdToken> {
  const authorization =
    request.header("x-studiohub-user-authorization") ??
    request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("AUTHENTICATION_REQUIRED");
  }
  return getAuth().verifyIdToken(authorization.slice("Bearer ".length), true);
}

/**
 * A rate-limit key for whoever is on the other end.
 *
 * Behind the App Hosting relay, `x-forwarded-for` and `request.ip` are the
 * relay's own address, so keying on them put every visitor to a studio's
 * inquiry form in one bucket — the sixth couple in an hour got a 429. The
 * relay passes the browser's address as `x-studiohub-client-ip`; functions are
 * private, so only the relay can have set it.
 */
export function requestFingerprint(request: Request, scope: string): string {
  const client = request.header("x-studiohub-client-ip")?.trim();
  const forwarded = request.header("x-forwarded-for")?.split(",")[0]?.trim();
  const address = client || forwarded || request.ip || "unknown";
  return createHash("sha256").update(`${scope}|${address}`).digest("hex");
}
