import { createHash } from "node:crypto";
import { adminAppCheck, adminFirestore } from "@/server/firebase/admin";

/**
 * Hold a public inquiry the form function could not take.
 *
 * 2026-10-22: no Cloud Function could start for over an hour and the public
 * form told two people "Your inquiry could not be submitted" — a studio's new
 * client, turned away by our outage. The relay
 * (app/api/functions/[functionName]/route.ts) now calls this when
 * publicLeadIntake answers 5xx or not at all: the website checks App Check
 * itself, keeps the submission in `pendingInquiries`, and answers the client
 * as received. functions/src/crm/pending-inquiries.ts delivers it through the
 * live form's own checks once functions answer again.
 *
 * Only what can be checked without the function: App Check, size, the
 * honeypot, and that it names a studio. Everything else is the delivery's.
 */

export const HELD_INQUIRY_MAX_BYTES = 64 * 1024;
/**
 * Without App Check — reCAPTCHA could not issue a token, so the browser sent
 * none — an inquiry is still held, but within tighter limits than the live
 * form's five an hour: per sender, and across every studio, so a bot that
 * skips App Check can't fill the queue. Delivery then runs every live check.
 */
export const UNVERIFIED_HOLDS_PER_SENDER_PER_HOUR = 3;
export const UNVERIFIED_HOLDS_PER_HOUR = 40;

export type HeldInquiryReply = { status: number; body: Record<string, unknown> };

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** The id a submission is held under: the same submission sent twice is held once. */
export function heldInquiryId(bytes: Uint8Array, clientAddress: string): string {
  return `held_${createHash("sha256").update(clientAddress).update(bytes).digest("hex").slice(0, 32)}`;
}

/** What the client's form sees: received, with a confirmation it can quote. */
export function heldInquiryReceipt(id: string): Record<string, unknown> {
  return { leadId: id, duplicate: false, availabilityStatus: "unknown", missingInformation: [], held: true };
}

export async function holdInquiry(input: {
  bytes: Uint8Array;
  appCheckToken: string | null;
  clientAddress: string | null;
  userAgent: string | null;
  reason: string;
}): Promise<HeldInquiryReply> {
  const verified = Boolean(input.appCheckToken);
  if (input.appCheckToken) {
    try {
      await adminAppCheck.verifyToken(input.appCheckToken);
    } catch {
      return { status: 401, body: { error: "APP_CHECK_REQUIRED" } };
    }
  }
  if (input.bytes.byteLength > HELD_INQUIRY_MAX_BYTES) return { status: 400, body: { error: "INVALID_INQUIRY" } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input.bytes));
  } catch {
    return { status: 400, body: { error: "INVALID_INQUIRY" } };
  }
  const body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const tenantSlug = text(body?.tenantSlug, 80);
  if (!body || !tenantSlug || !/^[a-z0-9-]{2,80}$/.test(tenantSlug) || !text(body.email, 320) || (text(body.honeypot, 200) ?? "") !== "")
    return { status: 400, body: { error: "INVALID_INQUIRY" } };

  // Which studio, as the inquiry page resolves it: any address it has had.
  const [byAlias, bySlug] = await Promise.all([
    adminFirestore.collection("tenants").where("slugAliases", "array-contains", tenantSlug).limit(1).get(),
    adminFirestore.collection("tenants").where("publicSlug", "==", tenantSlug).limit(1).get(),
  ]);
  const tenant = (byAlias.empty ? bySlug : byAlias).docs[0];
  if (!tenant) return { status: 404, body: { error: "INQUIRY_FORM_UNAVAILABLE" } };

  const clientAddress = input.clientAddress ?? "unknown";
  const id = heldInquiryId(input.bytes, clientAddress);
  const now = new Date().toISOString();
  if (!verified && !(await withinUnverifiedLimits(clientAddress))) return { status: 429, body: { error: "RATE_LIMITED" } };
  try {
    await adminFirestore.doc(`pendingInquiries/${id}`).create({
      id,
      tenantId: tenant.id,
      tenantSlug,
      body,
      clientAddress,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      status: "pending",
      attempts: 0,
      heldBecause: input.reason.slice(0, 200),
      verified,
      receivedAt: now,
      updatedAt: now,
    });
  } catch (caught) {
    // Already held (the same submission sent again): the same receipt.
    if ((caught as { code?: unknown }).code !== 6) throw caught;
  }
  console.error(
    `functions relay: publicLeadIntake ${verified ? "unavailable" : "sent without App Check"} (${input.reason}); held inquiry ${id} for ${tenant.id}`,
  );
  return { status: 202, body: heldInquiryReceipt(id) };
}

/** The hourly counters for unverified holds, in the same server-only collection as the form's. */
async function withinUnverifiedLimits(clientAddress: string): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13);
  const sender = adminFirestore.doc(
    `publicRateLimits/held_${createHash("sha256").update(`${clientAddress}|${hour}`).digest("hex").slice(0, 32)}`,
  );
  const everyone = adminFirestore.doc(`publicRateLimits/held_all_${hour.replace(/[^0-9]/g, "")}`);
  return adminFirestore.runTransaction(async (transaction) => {
    const [mine, all] = await Promise.all([transaction.get(sender), transaction.get(everyone)]);
    const mineCount = Number(mine.get("count") ?? 0) + 1;
    const allCount = Number(all.get("count") ?? 0) + 1;
    if (mineCount > UNVERIFIED_HOLDS_PER_SENDER_PER_HOUR || allCount > UNVERIFIED_HOLDS_PER_HOUR) return false;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    transaction.set(sender, { count: mineCount, expiresAt });
    transaction.set(everyone, { count: allCount, expiresAt });
    return true;
  });
}
