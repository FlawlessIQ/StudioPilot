import { randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { isReservedTestAddress } from "../communications/test-address.js";
import { appUrl, platformEmailJob } from "../console/studio-owner.js";
import { vendorTypeIsLive, vendorTypeLiveTrades } from "../trades/trades.js";
import { BOOKED_JOB_STATES, INVITED_VENDOR_TYPES, normalizeReferralCode } from "./referral-program.js";
import { emailHash, ensureReferralCode } from "./referrals.js";

/**
 * Vendor invites (Conor, 2026-10-08): the vendors on a studio's booked jobs
 * are invited to try StudioCue, by themselves, once.
 *
 * Once a day this looks at vendors added or changed in the last three days,
 * and at the vendors on jobs booked in the last three days.
 * A vendor is invited when:
 * - it is a vendor (INVITED_VENDOR_TYPES: not a venue, insurer or a client's
 *   own contact) with an email, on an upcoming booked job that isn't an
 *   imported, quiet one;
 * - its trade has a live StudioCue journey (trades.ts `LIVE_TRADES`):
 *   videographers, and since 2026-10-12 DJs and hair and makeup vendors;
 * - the studio is trialing or paying and hasn't turned invites off
 *   (Subscription → Refer a studio);
 * - the address has never been invited by anyone, never unsubscribed, and
 *   isn't already a StudioCue user (a couple or crew member signs in with it).
 *
 * The email names the vendor's own trade ("StudioCue runs your DJ bookings")
 * and its button opens the signup with that trade chosen
 * (`vendorInviteLink`). A videographer's carries the studio's referral code.
 *
 * `vendorInvites/{sha256(email)}` is the once-ever record and carries the
 * unsubscribe token; `emailSuppressions/{sha256(email)}` is the opt-out, read
 * again by the sender (operations/jobs.ts) in case it lands between queue and
 * send. The email is StudioCue's (letterhead, footer address), naming the
 * studio, and goes out under `tenantId: "platform"` so a bounce never shows on
 * the studio's Today as one of its own emails failing.
 *
 * The checks and the write are exported (`checkVendorInvite`,
 * `queueVendorInvite`) so the one-off launch sweep
 * (scripts/sweep-vendor-invites.mts) invites exactly as this does.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Per studio per day, so a studio adding a season of vendors doesn't send them all at once. */
export const PER_STUDIO_DAILY = 10;
/** Per run, to keep the sending reputation StudioCue's client mail depends on. */
export const PER_RUN = 200;

export type Eligibility = { ok: false } | { ok: true; studioName: string; code: string };

async function studioEligibility(db: Firestore, tenantId: string, ctx: InviteContext): Promise<Eligibility> {
  const cached = ctx.studios.get(tenantId);
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
    // A dry run writes nothing, so a studio with no code yet is shown without one.
    const code = ctx.dryRun
      ? (normalizeReferralCode(tenant.get("referralCode")) ?? "(made when sent)")
      : await ensureReferralCode(db, tenantId);
    if (studioName) result = { ok: true, studioName, code };
  }
  ctx.studios.set(tenantId, result);
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

/**
 * Where the invite's button goes: the signup with the vendor's own trade
 * chosen (`?trade=`, features/trades/chosen-trade.ts) and its plan. A hair
 * and makeup vendor could be either, so "What do you do?" asks. A
 * videographer signs up as a photographer, with the studio's referral code,
 * which only the Studio plan honors (stripe.ts); the vendor plan has no
 * referral offer yet (docs/vendor-journeys-plan.md, backlog), so a vendor's
 * link and email carry none.
 */
export function vendorInviteLink(vendorType: string, code: string): string {
  const trades = vendorTypeLiveTrades(vendorType);
  const query = new URLSearchParams();
  if (trades.includes("photographer")) query.set("code", code);
  else {
    if (trades.length === 1) query.set("trade", trades[0]!);
    query.set("plan", "vendor");
  }
  query.set("utm_source", "vendor_invite");
  query.set("utm_medium", "email");
  return `/auth/register?${query.toString()}`;
}

/** A vendor record, as read from `vendors/{id}` (a DocumentSnapshot is one). */
export type VendorRecord = { id: string; get(field: string): unknown };

/** Why a vendor isn't invited, for the launch sweep's dry run. */
export type InviteSkip =
  | "no_email"
  | "archived"
  | "not_a_vendor"
  | "trade_not_live"
  | "test_address"
  | "studio_daily_limit"
  | "already_invited"
  | "unsubscribed"
  | "studio_not_eligible"
  | "no_upcoming_booked_job"
  | "studio_client"
  | "already_a_user";

export type PreparedInvite = {
  vendorId: string;
  tenantId: string;
  email: string;
  hash: string;
  vendorType: string;
  projectId: string;
  studioName: string;
  code: string;
  recipientName: string | null;
};

export type InviteContext = {
  today: string;
  nowIso: string;
  /** Studio eligibility, cached for the run. */
  studios: Map<string, Eligibility>;
  /** Invites queued (or, in a dry run, that would be) per studio in this run. */
  sentToday: Map<string, number>;
  perStudio: number;
  /** Whether the address already signs in to StudioCue. */
  isUser: (email: string) => Promise<boolean>;
  /** Read only: no referral code is made. */
  dryRun: boolean;
};

export function inviteContext(nowIso: string, overrides: Partial<InviteContext> = {}): InviteContext {
  return {
    today: nowIso.slice(0, 10),
    nowIso,
    studios: new Map(),
    sentToday: new Map(),
    perStudio: PER_STUDIO_DAILY,
    isUser: alreadyAUser,
    dryRun: false,
    ...overrides,
  };
}

/**
 * Every rule an invite must pass, in the order the daily sweep has always
 * checked them. It writes nothing but, outside a dry run, the studio's
 * referral code the first time one is needed.
 */
export async function checkVendorInvite(
  db: Firestore,
  vendor: VendorRecord,
  ctx: InviteContext,
): Promise<{ ok: false; reason: InviteSkip } | { ok: true; invite: PreparedInvite }> {
  const tenantId = String(vendor.get("tenantId") ?? "");
  const email = String(vendor.get("email") ?? "").trim().toLowerCase();
  if (!tenantId || !email) return { ok: false, reason: "no_email" };
  if (vendor.get("archivedAt")) return { ok: false, reason: "archived" };
  const vendorType = String(vendor.get("type") ?? "");
  if (!(INVITED_VENDOR_TYPES as readonly string[]).includes(vendorType)) return { ok: false, reason: "not_a_vendor" };
  // Only to a trade with a journey: a florist invited now would land in a
  // photographer's studio (trades.ts LIVE_TRADES).
  if (!vendorTypeIsLive(vendorType)) return { ok: false, reason: "trade_not_live" };
  if (isReservedTestAddress(email)) return { ok: false, reason: "test_address" };
  if ((ctx.sentToday.get(tenantId) ?? 0) >= ctx.perStudio) return { ok: false, reason: "studio_daily_limit" };
  const hash = emailHash(email);
  const [invite, suppressed] = await Promise.all([db.doc(`vendorInvites/${hash}`).get(), db.doc(`emailSuppressions/${hash}`).get()]);
  if (invite.exists) return { ok: false, reason: "already_invited" };
  if (suppressed.exists) return { ok: false, reason: "unsubscribed" };
  const studio = await studioEligibility(db, tenantId, ctx);
  if (!studio.ok) return { ok: false, reason: "studio_not_eligible" };
  const rawProjectIds = vendor.get("projectIds");
  const projectIds = Array.isArray(rawProjectIds) ? rawProjectIds.map(String) : [];
  const projectId = await upcomingBookedJob(db, tenantId, projectIds, ctx.today);
  if (!projectId) return { ok: false, reason: "no_upcoming_booked_job" };
  // The studio's own client, under a vendor record ("one address in two roles").
  const asClient = await db.collection("contacts").where("tenantId", "==", tenantId).where("email", "==", email).limit(1).get();
  if (!asClient.empty) return { ok: false, reason: "studio_client" };
  if (await ctx.isUser(email)) return { ok: false, reason: "already_a_user" };
  return {
    ok: true,
    invite: {
      vendorId: vendor.id,
      tenantId,
      email,
      hash,
      vendorType,
      projectId,
      studioName: studio.studioName,
      code: studio.code,
      recipientName: String(vendor.get("contactName") ?? "").trim() || null,
    },
  };
}

/**
 * Writes the once-ever record and the email job together. `create` fails
 * with ALREADY_EXISTS (code 6) when another run invited the address first,
 * which the caller treats as done.
 */
export async function queueVendorInvite(db: Firestore, invite: PreparedInvite, ctx: InviteContext): Promise<string> {
  if (ctx.dryRun) throw new Error("DRY_RUN_WRITES_NOTHING");
  const token = randomBytes(18).toString("base64url");
  const jobId = `vendor_invite_${invite.hash.slice(0, 32)}`;
  const batch = db.batch();
  batch.create(db.doc(`vendorInvites/${invite.hash}`), {
    id: invite.hash,
    tenantId: invite.tenantId,
    vendorId: invite.vendorId,
    projectId: invite.projectId,
    vendorType: invite.vendorType,
    code: invite.code,
    unsubscribeToken: token,
    emailJobId: jobId,
    createdAt: ctx.nowIso,
  });
  batch.create(
    db.doc(`emailJobs/${jobId}`),
    platformEmailJob(
      jobId,
      {
        type: "platform_vendor_invite",
        recipient: invite.email,
        recipientName: invite.recipientName,
        soleRecipient: true,
        referrerTenantId: invite.tenantId,
        studioName: invite.studioName,
        code: invite.code,
        // The trades the vendor would sign up as (trades.ts), so the email
        // names theirs: "StudioCue runs your DJ bookings".
        vendorType: invite.vendorType,
        inviteTrades: [...vendorTypeLiveTrades(invite.vendorType)],
        actionUrl: appUrl(vendorInviteLink(invite.vendorType, invite.code)),
        unsubscribeUrl: appUrl(`/api/public/unsubscribe?e=${invite.hash}&t=${token}`),
        maxAttempts: 5,
        createdBy: "vendor-invites",
      },
      ctx.nowIso,
    ),
  );
  await batch.commit();
  ctx.sentToday.set(invite.tenantId, (ctx.sentToday.get(invite.tenantId) ?? 0) + 1);
  return jobId;
}

export async function sweepVendorInvites(db: Firestore, nowIso: string): Promise<{ queued: number; looked: number }> {
  const since = new Date(Date.parse(nowIso) - 3 * DAY_MS).toISOString();
  // Vendors changed lately, and the vendors on jobs booked lately: one added
  // while the job was still an inquiry is invited once it books.
  const changed = await db.collection("vendors").where("updatedAt", ">=", since).limit(2000).get();
  const booked = await db.collection("projects").where("bookingCompletedAt", ">=", since).limit(500).get();
  const onBooked = await Promise.all(
    booked.docs.map((project) => db.collection("vendors").where("projectIds", "array-contains", project.id).limit(50).get()),
  );
  const seen = new Set<string>();
  const recent = { docs: [...changed.docs, ...onBooked.flatMap((result) => result.docs)].filter((doc) => !seen.has(doc.id) && seen.add(doc.id)) };
  const ctx = inviteContext(nowIso);
  let queued = 0;
  for (const vendor of recent.docs) {
    if (queued >= PER_RUN) break;
    try {
      const check = await checkVendorInvite(db, vendor, ctx);
      if (!check.ok) continue;
      await queueVendorInvite(db, check.invite, ctx);
      queued += 1;
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
