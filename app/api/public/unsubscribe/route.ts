import { timingSafeEqual } from "node:crypto";
import { adminFirestore } from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opt out of StudioCue's own sales mail (functions/src/saas/vendor-invites.ts).
 *
 * The link in a vendor invite, and its List-Unsubscribe header, point here
 * with the address's hash and the token made for it. A mail client's one-click
 * unsubscribe (RFC 8058) POSTs; a person clicking the link GETs, and is sent to
 * /unsubscribe to confirm, so a mail scanner opening links can't unsubscribe
 * anyone. Either way nothing is read back but whether it worked.
 */

const HASH = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

function tokenMatches(expected: unknown, given: string): boolean {
  if (typeof expected !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function appBase(request: Request): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = new URL(`${appBase(request)}/unsubscribe`);
  for (const key of ["e", "t"]) {
    const value = url.searchParams.get(key);
    if (value) next.searchParams.set(key, value);
  }
  return Response.redirect(next.toString(), 303);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  let hash = url.searchParams.get("e") ?? "";
  let token = url.searchParams.get("t") ?? "";
  let fromPage = false;
  if ((request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    const form = await request.formData().catch(() => null);
    // A mail client's one-click sends only "List-Unsubscribe=One-Click".
    fromPage = !form?.has("List-Unsubscribe");
    hash = String(form?.get("e") ?? hash);
    token = String(form?.get("t") ?? token);
  }
  const done = (ok: boolean) =>
    fromPage
      ? Response.redirect(`${appBase(request)}/unsubscribe?${ok ? "done=1" : "failed=1"}`, 303)
      : Response.json({ ok }, { status: ok ? 200 : 400 });
  if (!HASH.test(hash) || !TOKEN.test(token)) return done(false);
  const invite = await adminFirestore.doc(`vendorInvites/${hash}`).get();
  if (!invite.exists || !tokenMatches(invite.get("unsubscribeToken"), token)) return done(false);
  await adminFirestore.doc(`emailSuppressions/${hash}`).set(
    { id: hash, reason: "unsubscribe", source: "vendor_invite", createdAt: new Date().toISOString() },
    { merge: true },
  );
  return done(true);
}
