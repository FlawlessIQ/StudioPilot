/**
 * The one-off launch sweep of vendor invites (docs/vendor-journeys-plan.md,
 * Phase 6).
 *
 * DJ, makeup and hair went live on 2026-10-12, and the wedding planner in
 * Phase 5 of docs/planner-journey-plan.md (trades.ts LIVE_TRADES). The
 * daily invite sweep (functions/src/saas/vendor-invites.ts) only looks at
 * vendors changed, or jobs booked, in the last three days, so the DJs, hair
 * and makeup vendors and planners already sitting on booked jobs would never
 * be invited. This finds them: vendors of a newly live trade, on an upcoming
 * booked job, never invited.
 *
 * Selection is pure and tested (functions/src/saas/vendor-invite-sweep.ts,
 * tests/vendor-invite-sweep.test.ts). Each vendor it picks then goes through
 * the daily sweep's own checks and write (`checkVendorInvite`,
 * `queueVendorInvite`): the once-ever `vendorInvites/{hash}` record, the
 * opt-out, the studio's switch and subscription, an existing StudioCue user,
 * the studio's own client, the per-studio cap. A second run finds everyone
 * already invited.
 *
 * DRY RUN by default: prints who would be invited and why anyone isn't, with
 * counts per trade and per studio, and writes nothing (not even a studio's
 * referral code). `--send` queues the emails; the render worker sends them.
 *
 *   # the emulator (FIRESTORE_EMULATOR_HOST set): dry run, then send
 *   npx tsx scripts/sweep-vendor-invites.mts
 *   npx tsx scripts/sweep-vendor-invites.mts --send
 *
 *   # production needs --prod as well, and your gcloud application-default credentials;
 *   # sending also needs the Stripe key the scheduler has (to make a missing referral code)
 *   npx tsx scripts/sweep-vendor-invites.mts --prod
 *   STRIPE_SECRET_KEY=$(gcloud secrets versions access latest --secret=STRIPE_SECRET_KEY --project=studiohub-prod) \
 *     npx tsx scripts/sweep-vendor-invites.mts --prod --send
 *
 *   # in the emulator, --send takes BILLING_MOCK_MODE=true instead
 *
 *   # the planner's launch only (Phase 5): every command above takes --trade
 *   npx tsx scripts/sweep-vendor-invites.mts --trade planner
 *
 * Options: `--trade <trade>[,<trade>…]` limits it to those launches (dj,
 * makeup, hair, planner; default all of them — anyone already invited is
 * skipped as `already_invited`); `--tenant <id>[,<id>…]` limits it to those studios;
 * `--per-studio <n>` (default 10, as the daily sweep) and `--limit <n>`
 * (default 200 per run) cap the sends — anyone left over is named, and a
 * re-run tomorrow picks them up.
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import {
  launchedTradesFrom,
  launchedVendorTypes,
  sweepCandidates,
  sweepCounts,
  sweepTradeLabel,
  type SweepJob,
  type SweepVendor,
} from "../functions/src/saas/vendor-invite-sweep.ts";
import {
  PER_RUN,
  PER_STUDIO_DAILY,
  checkVendorInvite,
  inviteContext,
  queueVendorInvite,
  type InviteSkip,
} from "../functions/src/saas/vendor-invites.ts";

const args = process.argv.slice(2);
const send = args.includes("--send");
const prod = args.includes("--prod");
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const option = (name: string): string[] =>
  args
    .flatMap((arg, index) => (arg === name ? [args[index + 1] ?? ""] : arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("--"));
const number = (name: string, fallback: number): number => {
  const value = Number(option(name)[0]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};
const tenants = new Set(option("--tenant"));
let launched: ReturnType<typeof launchedTradesFrom>;
try {
  launched = launchedTradesFrom(option("--trade"));
} catch (caught: unknown) {
  console.error(caught instanceof Error ? caught.message : String(caught));
  process.exit(1);
}
const perStudio = number("--per-studio", PER_STUDIO_DAILY);
const limit = number("--limit", PER_RUN);

if (!emulator && !prod) {
  console.error("Refusing to run: set FIRESTORE_EMULATOR_HOST for the emulator, or pass --prod for studiohub-prod.");
  process.exit(1);
}
if (emulator && prod) {
  console.error("FIRESTORE_EMULATOR_HOST is set and --prod was passed; pick one.");
  process.exit(1);
}

// A studio's referral code is made the first time it is needed, and making
// one checks Stripe for a promotion code of the same name (saas/referrals.ts
// ensureReferralCode), as the daily scheduler does with its STRIPE_SECRET_KEY.
if (send && !process.env.STRIPE_SECRET_KEY && process.env.BILLING_MOCK_MODE !== "true") {
  console.error(
    "--send needs STRIPE_SECRET_KEY (or BILLING_MOCK_MODE=true in the emulator), as vendorInviteScheduler has:\n" +
      "  STRIPE_SECRET_KEY=$(gcloud secrets versions access latest --secret=STRIPE_SECRET_KEY --project=studiohub-prod)",
  );
  process.exit(1);
}

if (!getApps().length) {
  initializeApp(
    emulator
      ? { projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "studiohub-dev" }
      : { credential: applicationDefault(), projectId: "studiohub-prod" },
  );
}
const db = getFirestore();
const auth = getAuth();

const text = (value: unknown) => (typeof value === "string" ? value : "");

async function isUser(email: string): Promise<boolean> {
  try {
    await auth.getUserByEmail(email);
    return true;
  } catch (caught: unknown) {
    if ((caught as { code?: string })?.code === "auth/user-not-found") return false;
    throw caught;
  }
}

async function main() {
  const now = new Date().toISOString();
  const types = launchedVendorTypes(launched);
  console.log(`${send ? "SENDING" : "DRY RUN (nothing is written)"}: vendor invites for ${types.map(sweepTradeLabel).join(", ")}`);
  console.log(`Target: ${emulator ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : "studiohub-prod"}`);
  console.log(`Caps: ${perStudio} per studio, ${limit} in all${tenants.size ? `; studios: ${[...tenants].join(", ")}` : ""}\n`);

  const vendorDocs = (await db.collection("vendors").where("type", "in", types).get()).docs.filter(
    (doc) => !tenants.size || tenants.has(text(doc.get("tenantId"))),
  );
  const projectIds = [
    ...new Set(vendorDocs.flatMap((doc) => (Array.isArray(doc.get("projectIds")) ? (doc.get("projectIds") as unknown[]).map(String) : []))),
  ];
  const jobs = new Map<string, SweepJob>();
  for (let index = 0; index < projectIds.length; index += 30) {
    const chunk = projectIds.slice(index, index + 30);
    const found = await db.collection("projects").where(FieldPath.documentId(), "in", chunk).get();
    for (const project of found.docs)
      jobs.set(project.id, {
        id: project.id,
        tenantId: text(project.get("tenantId")),
        state: text(project.get("state")),
        eventDate: text(project.get("eventDate")).slice(0, 10),
        archived: Boolean(project.get("archivedAt")),
        quiet: Boolean(project.get("clientAutomationsPausedAt")),
      });
  }
  const byId = new Map<string, DocumentSnapshot>(vendorDocs.map((doc) => [doc.id, doc]));
  const vendors: SweepVendor[] = vendorDocs.map((doc) => ({
    id: doc.id,
    tenantId: text(doc.get("tenantId")),
    type: text(doc.get("type")),
    email: text(doc.get("email")),
    archived: Boolean(doc.get("archivedAt")),
    projectIds: Array.isArray(doc.get("projectIds")) ? (doc.get("projectIds") as unknown[]).map(String) : [],
  }));
  const candidates = sweepCandidates(vendors, jobs, now.slice(0, 10), launched);
  console.log(`${vendorDocs.length} vendor records of those types; ${candidates.length} on an upcoming booked job.\n`);

  const ctx = inviteContext(now, { perStudio, isUser, dryRun: !send });
  const invited: { tenantId: string; vendorType: string }[] = [];
  const skipped = new Map<InviteSkip | "run_limit" | "error", number>();
  const skip = (reason: InviteSkip | "run_limit" | "error") => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  for (const candidate of candidates) {
    const label = `${candidate.tenantId}  ${sweepTradeLabel(candidate.vendorType).padEnd(14)} ${candidate.email}  (job ${candidate.projectId}, ${candidate.eventDate})`;
    if (invited.length >= limit) {
      skip("run_limit");
      console.log(`  later   ${label}: over this run's limit`);
      continue;
    }
    try {
      const check = await checkVendorInvite(db as never, byId.get(candidate.vendorId)!, ctx);
      if (!check.ok) {
        skip(check.reason);
        console.log(`  skip    ${label}: ${check.reason}`);
        continue;
      }
      if (send) await queueVendorInvite(db as never, check.invite, ctx);
      // A dry run counts as it goes, so the per-studio cap reads as a send would.
      else ctx.sentToday.set(check.invite.tenantId, (ctx.sentToday.get(check.invite.tenantId) ?? 0) + 1);
      invited.push(candidate);
      console.log(`  ${send ? "queued " : "invite "} ${label} for ${check.invite.studioName}`);
    } catch (caught: unknown) {
      if ((caught as { code?: unknown })?.code === 6) {
        skip("already_invited");
        console.log(`  skip    ${label}: already_invited (just now, by another run)`);
        continue;
      }
      skip("error");
      console.log(`  error   ${label}: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  const counts = sweepCounts(invited);
  console.log(`\n${send ? "Queued" : "Would invite"}: ${invited.length}`);
  console.log("  by trade: ", counts.byTrade);
  console.log("  by studio:", counts.byStudio);
  console.log("Not invited:", Object.fromEntries([...skipped].sort(([a], [b]) => a.localeCompare(b))));
  if (!send && invited.length) console.log("\nNothing was written. Re-run with --send to queue these.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
