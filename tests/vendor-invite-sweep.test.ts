import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderEmailTemplate, vendorInvitePitch } from "../functions/src/communications/email-templates";
import {
  launchedVendorTypes,
  sweepCandidates,
  sweepCounts,
  sweepTradeLabel,
  upcomingBookedJobOf,
  type SweepJob,
  type SweepVendor,
} from "../functions/src/saas/vendor-invite-sweep";
import { vendorInviteLink } from "../functions/src/saas/vendor-invites";
import { vendorTypeIsLive, vendorTypeLiveTrades } from "../functions/src/trades/trades";

/**
 * The DJ, makeup and hair launch (docs/vendor-journeys-plan.md, Phase 6):
 * the vendors of those trades are invited in their own trade's words, and a
 * one-off sweep finds the ones already on booked jobs. The selection is pure
 * and deterministic; the sends go through the daily sweep's own checks.
 */

const read = (path: string) => readFileSync(path, "utf8");
const TODAY = "2026-10-12";

const job = (id: string, overrides: Partial<SweepJob> = {}): SweepJob => ({
  id,
  tenantId: "t1",
  state: "BOOKED",
  eventDate: "2027-06-12",
  archived: false,
  quiet: false,
  ...overrides,
});

const vendor = (id: string, overrides: Partial<SweepVendor> = {}): SweepVendor => ({
  id,
  tenantId: "t1",
  type: "dj",
  email: `${id}@spin.studio`,
  archived: false,
  projectIds: ["p1"],
  ...overrides,
});

const JOBS = new Map(
  [
    job("p1"),
    job("p2", { eventDate: "2027-03-01" }),
    job("past", { eventDate: "2026-09-01" }),
    job("lead", { state: "LEAD" }),
    job("quiet", { quiet: true }),
    job("gone", { archived: true }),
    job("other-studio", { tenantId: "t2" }),
    job("t2job", { tenantId: "t2" }),
    job("today", { eventDate: TODAY }),
  ].map((entry) => [entry.id, entry]),
);

test("the launch sweep covers DJs, hair and makeup vendors and planners, not the videographers already invited", () => {
  assert.deepEqual(launchedVendorTypes(), ["planner", "dj", "hair_makeup"]);
  assert.deepEqual(launchedVendorTypes(["dj", "makeup", "hair"]), ["dj", "hair_makeup"]);
  assert.equal(vendorTypeIsLive("dj"), true);
  assert.equal(vendorTypeIsLive("hair_makeup"), true);
  assert.deepEqual([...vendorTypeLiveTrades("hair_makeup")], ["makeup", "hair"]);
  assert.equal(vendorTypeIsLive("florist"), false);
  assert.equal(sweepTradeLabel("dj"), "DJ");
  assert.equal(sweepTradeLabel("hair_makeup"), "Makeup or hair");
});

test("a vendor is put forward only on an upcoming booked job in its own studio", () => {
  const upcoming = (projectIds: string[]) => upcomingBookedJobOf(vendor("v", { projectIds }), JOBS, TODAY)?.id ?? null;
  assert.equal(upcoming(["p1"]), "p1");
  assert.equal(upcoming(["p1", "p2"]), "p2", "the soonest job");
  assert.equal(upcoming(["today"]), "today", "an event today is still upcoming");
  for (const id of ["past", "lead", "quiet", "gone", "other-studio", "missing"]) assert.equal(upcoming([id]), null, id);
});

test("the selection is deterministic: filtered, one per address, in studio and address order", () => {
  const vendors = [
    vendor("zed", { email: " Zed@Spin.Studio " }),
    vendor("amy"),
    vendor("glam", { type: "hair_makeup", projectIds: ["p2"] }),
    vendor("video", { type: "videographer" }),
    vendor("flor", { type: "florist" }),
    vendor("old", { archived: true }),
    vendor("noemail", { email: "" }),
    vendor("fixture", { email: "dj@example.com" }),
    vendor("inquiry", { projectIds: ["lead"] }),
    // The same DJ on another studio's job: invited once, by the first studio.
    vendor("amy-again", { tenantId: "t2", email: "amy@spin.studio", projectIds: ["t2job"] }),
    vendor("t2dj", { tenantId: "t2", projectIds: ["t2job"] }),
  ];
  const picked = sweepCandidates(vendors, JOBS, TODAY);
  assert.deepEqual(
    picked.map((candidate) => [candidate.tenantId, candidate.vendorId, candidate.email, candidate.projectId]),
    [
      ["t1", "amy", "amy@spin.studio", "p1"],
      ["t1", "glam", "glam@spin.studio", "p2"],
      ["t1", "zed", "zed@spin.studio", "p1"],
      ["t2", "t2dj", "t2dj@spin.studio", "t2job"],
    ],
  );
  // Any order in, the same list out.
  assert.deepEqual(sweepCandidates([...vendors].reverse(), JOBS, TODAY), picked);
  assert.deepEqual(sweepCounts(picked), {
    byTrade: { DJ: 3, "Makeup or hair": 1 },
    byStudio: { t1: 3, t2: 1 },
  });
});

test("the invite lands a vendor on the signup with their own trade chosen", () => {
  const dj = new URL(vendorInviteLink("dj", "GRPRODUCTIONS"), "https://studio-cue.com");
  assert.equal(dj.pathname, "/auth/register");
  assert.equal(dj.searchParams.get("trade"), "dj");
  assert.equal(dj.searchParams.get("plan"), "vendor");
  assert.equal(dj.searchParams.get("code"), null, "the vendor plan has no referral offer yet");
  assert.equal(dj.searchParams.get("utm_source"), "vendor_invite");
  const beauty = new URL(vendorInviteLink("hair_makeup", "GR"), "https://studio-cue.com");
  assert.equal(beauty.searchParams.get("trade"), null, "hair or makeup: the signup asks");
  assert.equal(beauty.searchParams.get("plan"), "vendor");
  const video = new URL(vendorInviteLink("videographer", "GRPRODUCTIONS"), "https://studio-cue.com");
  assert.equal(video.searchParams.get("code"), "GRPRODUCTIONS");
  assert.equal(video.searchParams.get("trade"), null);
});

const brand = { studioName: "StudioCue", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const invite = (inviteTrades: string[]) =>
  renderEmailTemplate({
    key: "platform_vendor_invite",
    brand,
    recipientName: "Sam Rivera",
    projectName: null,
    values: {
      studioName: "GR Productions",
      code: "GRPRODUCTIONS",
      inviteTrades,
      actionUrl: "https://studio-cue.com/auth/register?trade=dj",
      unsubscribeUrl: "https://studio-cue.com/api/public/unsubscribe?e=x&t=y",
    },
  });

test("the invite names the vendor's own trade and the vendor plan's price, with no referral offer", () => {
  const dj = invite(["dj"]).text;
  assert.match(dj, /StudioCue runs your DJ bookings/);
  assert.match(dj, /Music & moments planner/);
  assert.match(dj, /\$75 a month, or \$750 a year/);
  assert.doesNotMatch(dj, /half|\$150|\$100|Your code|GRPRODUCTIONS/);
  assert.doesNotMatch(dj, /photo|galler/i);
  assert.match(invite(["hair"]).text, /StudioCue runs your hair bookings[\s\S]*extensions/);
  assert.match(invite(["makeup"]).text, /StudioCue runs your makeup bookings/);
  assert.doesNotMatch(invite(["makeup"]).text, /extensions/);
  assert.match(invite(["makeup", "hair"]).text, /StudioCue runs hair and makeup bookings[\s\S]*pick hair or makeup/);
  // A videographer, who signs up as a photographer, keeps the referral invite.
  const video = invite(["photographer"]).text;
  assert.match(video, /half the usual \$150/);
  assert.match(video, /GRPRODUCTIONS/);
  assert.equal(vendorInvitePitch(undefined), null);
  assert.equal(vendorInvitePitch(["florist"]), null);
});

test("the daily sweep and the launch script share one check and one write", () => {
  const daily = read("functions/src/saas/vendor-invites.ts");
  assert.match(daily, /const check = await checkVendorInvite\(db, vendor, ctx\);/);
  assert.match(daily, /await queueVendorInvite\(db, check\.invite, ctx\);/);
  assert.match(daily, /if \(!vendorTypeIsLive\(vendorType\)\) return \{ ok: false, reason: "trade_not_live" \};/);
  assert.match(daily, /if \(ctx\.dryRun\) throw new Error\("DRY_RUN_WRITES_NOTHING"\);/);
  const script = read("scripts/sweep-vendor-invites.mts");
  assert.match(script, /const send = args\.includes\("--send"\);/);
  assert.match(script, /dryRun: !send/);
  assert.match(script, /if \(send\) await queueVendorInvite\(/);
  assert.match(script, /checkVendorInvite\(/);
  assert.match(script, /sweepCandidates\(vendors, jobs, now\.slice\(0, 10\), launched\)/);
  assert.match(script, /launchedVendorTypes\(launched\)/);
  assert.match(script, /launched = launchedTradesFrom\(option\("--trade"\)\)/);
  // Production only when asked for by name.
  assert.match(script, /if \(!emulator && !prod\) \{/);
});
