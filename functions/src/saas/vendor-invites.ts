import { randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { isReservedTestAddress } from "../communications/test-address.js";
import { appUrl, platformEmailJob } from "../console/studio-owner.js";
import { vendorTypeIsLive } from "../trades/trades.js";
import { BOOKED_JOB_STATES, INVITED_VENDOR_TYPES } from "./referral-program.js";
import { emailHash, ensureReferralCode } from "./referrals.js";

/**
 * Vendor invites (Conor, 2026-10-08): the vendors on a studio's booked jobs
 * are invited to try StudioCue with that studio's referral code, by
 * themselves, once.
 *
 * Once a day this looks at vendors added or changed in the last three days,
 * and at the vendors on jobs booked in the last three days.
 * A vendor is invited when:
 * - it is a vendor (INVITED_VENDOR_TYPES: not a venue, insurer or a client's
 *   own contact) with an email, on an upcoming booked job that isn't an
 *   imported, quiet one;
 * - its trade has a live StudioCue journey (trades.ts `LIVE_TRADES`): until
 *   the DJ, makeup and hair journeys launch, only videographers qualify;
 * - the studio is trialing or paying and hasn't turned invites off
 *   (Subscription → Refer a studio);
 * - the address has never been invited by anyone, never unsubscribed, and
 *   isn't already a StudioCue user (a couple or crew member signs in with it).
 *
 * `vendorInvites/{sha256(email)}` is the once-ever record and carries the
 * unsubscribe token; `emailSuppressions/{sha256(email)}` is the opt-out, read
 * again by the sender (operations/jobs.ts) in case it lands between queue and
 * send. The email is StudioCue's (letterhead, footer address), naming the
 * studio, and goes out under `tenantId: "platform"` so a bounce never shows on
 * the studio's Today as one of its own emails failing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Per studio per day, so a studio adding a season of vendors doesn't send them all at once. */
export const PER_STUDIO_DAILY = 10;
/** Per run, to keep the sending reputation StudioCue's client mail depends on. */
export const PER_RUN = 200;

type Eligibility = { ok: false } | { ok: true; studioName: string; code: string };

async function studioEligibility(db: Firestore, tenantId: string, cache: Map<string, Eligibility>): Promise<Eligibility> {
  const cached = cache.get(tenantId);
  if (cached) return cached;
  const [tenant, subscription] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`subscriptions/${tenantId}`).get()]);
  let result: Eligibility = { ok: false };
  if (
    tenant.exists &&
    !tenant.get("archivedAt") &&
    tenant.get("vendorInvitesEnabled") !== false &&
    ["trialing", "active"].includes(String(subscription.get("status") ?? ""))
  ) {
    const studioName = String(tenant.get("brandName") ?? tenant.get("businessName") ?? tenant.get("name") ?? "").trim();
    if (studioName) result = { ok: true, studioName, code: await ensureReferralCode(db, tenantId) };
  }
  cache.set(tenantId, result);
  return result;
}

/** An upcoming, booked, not-imported job among the vendor's. */
async function upcomingBookedJob(db: Firestore, tenantId: string, projectIds: string[], today: string): Promise<string | null> {
  for (const projectId of projectIds.slice(0, 20)) {
    const project = await db.doc(`projects/${projectId}`).get();
    if (!project.exists || project.get("tenantId") !== tenantId || project.get("archivedAt")) continue;
    if (!(BOOKED_JOB_STATES as readonly string[]).includes(String(project.get("state") ?? ""))) continue;
    if (project.get("clientAutomationsPausedAt")) continue;
    const eventDate = String(project.get("eventDate") ?? "").slice(0, 10);
    if (!eventDate || eventDate < today) continue;
    return projectId;
  }
  return null;
}

async function alreadyAUser(email: string): Promise<boolean> {
  try {
    await getAuth().getUserByEmail(email);
    return true;
  } catch (caught: unknown) {
    if ((caught as { code?: string })?.code === "auth/user-not-found") return false;
    throw caught;
  }
}

export async function sweepVendorInvites(db: Firestore, nowIso: string): Promise<{ queued: number; looked: number }> {
  const since = new Date(Date.parse(nowIso) - 3 * DAY_MS).toISOString();
  const today = nowIso.slice(0, 10);
  // Vendors changed lately, and the vendors on jobs booked lately: one added
  // while the job was still an inquiry is invited once it books.
  const changed = await db.collection("vendors").where("updatedAt", ">=", since).limit(2000).get();
  const booked = await db.collection("projects").where("bookingCompletedAt", ">=", since).limit(500).get();
  const onBooked = await Promise.all(
    booked.docs.map((project) => db.collection("vendors").where("projectIds", "array-contains", project.id).limit(50).get()),
  );
  const seen = new Set<string>();
  const recent = { docs: [...changed.docs, ...onBooked.flatMap((result) => result.docs)].filter((doc) => !seen.has(doc.id) && seen.add(doc.id)) };
  const studios = new Map<string, Eligibility>();
  const sentToday = new Map<string, number>();
  let queued = 0;
  for (const vendor of recent.docs) {
    if (queued >= PER_RUN) break;
    try {
      const tenantId = String(vendor.get("tenantId") ?? "");
      const email = String(vendor.get("email") ?? "").trim().toLowerCase();
      if (!tenantId || !email || vendor.get("archivedAt")) continue;
      const vendorType = String(vendor.get("type") ?? "");
      if (!(INVITED_VENDOR_TYPES as readonly string[]).includes(vendorType)) continue;
      // Only to a trade with a journey: a DJ invited before the DJ journey
      // exists would land in a photographer's studio (trades.ts LIVE_TRADES).
      if (!vendorTypeIsLive(vendorType)) continue;
      if (isReservedTestAddress(email)) continue;
      if ((sentToday.get(tenantId) ?? 0) >= PER_STUDIO_DAILY) continue;
      const hash = emailHash(email);
      const [invite, suppressed] = await Promise.all([db.doc(`vendorInvites/${hash}`).get(), db.doc(`emailSuppressions/${hash}`).get()]);
      if (invite.exists || suppressed.exists) continue;
      const studio = await studioEligibility(db, tenantId, studios);
      if (!studio.ok) continue;
      const projectIds = Array.isArray(vendor.get("projectIds")) ? (vendor.get("projectIds") as unknown[]).map(String) : [];
      const projectId = await upcomingBookedJob(db, tenantId, projectIds, today);
      if (!projectId) continue;
      // The studio's own client, under a vendor record ("one address in two roles").
      const asClient = await db.collection("contacts").where("tenantId", "==", tenantId).where("email", "==", email).limit(1).get();
      if (!asClient.empty) continue;
      if (await alreadyAUser(email)) continue;

      const token = randomBytes(18).toString("base64url");
      const jobId = `vendor_invite_${hash.slice(0, 32)}`;
      const batch = db.batch();
      batch.create(db.doc(`vendorInvites/${hash}`), {
        id: hash,
        tenantId,
        vendorId: vendor.id,
        projectId,
        vendorType: String(vendor.get("type") ?? ""),
        code: studio.code,
        unsubscribeToken: token,
        emailJobId: jobId,
        createdAt: nowIso,
      });
      batch.create(
        db.doc(`emailJobs/${jobId}`),
        platformEmailJob(
          jobId,
          {
            type: "platform_vendor_invite",
            recipient: email,
            recipientName: String(vendor.get("contactName") ?? "").trim() || null,
            soleRecipient: true,
            referrerTenantId: tenantId,
            studioName: studio.studioName,
            code: studio.code,
            actionUrl: appUrl(`/auth/register?code=${encodeURIComponent(studio.code)}&utm_source=vendor_invite&utm_medium=email`),
            unsubscribeUrl: appUrl(`/api/public/unsubscribe?e=${hash}&t=${token}`),
            maxAttempts: 5,
            createdBy: "vendor-invites",
          },
          nowIso,
        ),
      );
      await batch.commit();
      queued += 1;
      sentToday.set(tenantId, (sentToday.get(tenantId) ?? 0) + 1);
    } catch (caught: unknown) {
      // ALREADY_EXISTS: another run invited this address first.
      if ((caught as { code?: unknown })?.code === 6) continue;
      logger.warn("vendor_invite_failed", { vendorId: vendor.id, error: caught instanceof Error ? caught.message : String(caught) });
    }
  }
  return { queued, looked: recent.docs.length };
}

/** Once a day, mid-morning Eastern: the vendors added to booked jobs lately. */
export const vendorInviteScheduler = onSchedule(
  { schedule: "every day 15:30", timeZone: "UTC", retryCount: 1, secrets: ["STRIPE_SECRET_KEY"] },
  async () => {
    const result = await sweepVendorInvites(getFirestore(), new Date().toISOString());
    logger.info("vendor_invites_swept", result);
  },
);
