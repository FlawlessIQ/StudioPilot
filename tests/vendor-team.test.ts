import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  budgetLine,
  isVendorArrivalLine,
  timelineStateFor,
  timelineSummary,
  vendorArrivalLines,
  vendorTeamProgress,
  vendorTeamVisibility,
} from "../features/vendors/team";
import { VENDOR_TYPES } from "../features/vendors/schema";
import { flowEnds } from "../features/schedules/day-plan";
import { vendorVisibleItems } from "../features/schedules/vendor-share";
import type { ScheduleItem } from "../features/schedules/schema";
import { manualScheduleItem } from "../features/planning/manual-run-of-show";
import { TRADES, tradeProfile } from "../features/trades/trades";
import { tradeProfile as serverTradeProfile } from "../functions/src/trades/trades";
import {
  VENDOR_TEAM_CATEGORIES,
  budgetPrefillCents,
  coupleNameOf,
  crewVendorContactsFrom,
  parseBudgetCents,
  planVendorTimelineSends,
  teamShareScope,
} from "../functions/src/planning/vendor-team";
import { renderEmailTemplate, VENDOR_EMAIL_TYPES } from "../functions/src/communications/email-templates";
import { billingHoldApplies } from "../functions/src/saas/billing-hold";

/**
 * A wedding's vendor team (docs/planner-journey-plan.md, Phase 1).
 *
 * Every deterministic piece: where the team stands, the light budget, the
 * arrival lines on the run of show, who gets the timeline when the studio
 * presses send, and that nothing about a photographer's, DJ's or beauty
 * studio's job changes until they add a vendor.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// As the server writes them (functions/src/planning/vendor-team.ts).
const entry = (overrides: Record<string, unknown>) => ({
  entryId: "pv_florist",
  vendorId: "vendor_petal",
  category: "florist",
  roleLabel: null,
  status: "booked",
  company: "Petal & Stem",
  arrivalTime: null,
  loadInTime: null,
  costCents: null,
  balanceDueCents: null,
  tipCents: null,
  archivedAt: null,
  ...overrides,
});
const share = (vendorContactId: string, overrides: Record<string, unknown> = {}) => ({
  vendorContactId,
  status: "sent",
  revokedAt: null,
  sharedVersion: 2,
  acknowledgedVersion: null,
  ...overrides,
});

test("a vendor's timeline reads against the current version", () => {
  assert.equal(timelineStateFor(null, 2), "not_sent");
  assert.equal(timelineStateFor(share("v", { status: "revoked" }), 2), "not_sent");
  assert.equal(timelineStateFor(share("v"), 2), "sent");
  assert.equal(timelineStateFor(share("v", { status: "viewed" }), 2), "viewed");
  assert.equal(timelineStateFor(share("v", { status: "acknowledged", acknowledgedVersion: 2 }), 2), "confirmed");
  // Confirming the old day is not confirming this one.
  assert.equal(timelineStateFor(share("v", { status: "acknowledged", sharedVersion: 1, acknowledgedVersion: 1 }), 2), "older");
  assert.equal(timelineStateFor(share("v", { sharedVersion: 1 }), null), "sent");
});

test("progress counts the team, the money and the timeline, declined left out", () => {
  const entries = [
    entry({ entryId: "a", vendorId: "v1", costCents: 420000, balanceDueCents: 120000, tipCents: 10000 }),
    entry({ entryId: "b", vendorId: "v2", category: "dj", costCents: 300000 }),
    entry({ entryId: "c", vendorId: "v3", category: "caterer", costCents: 1120000 }),
    entry({ entryId: "d", vendorId: null, category: "bakery", status: "needed" }),
    entry({ entryId: "e", vendorId: "v5", category: "band", status: "considering", costCents: 900000 }),
    entry({ entryId: "f", vendorId: "v6", category: "photographer", status: "declined", costCents: 500000 }),
  ];
  const shares = [
    share("v1", { status: "acknowledged", acknowledgedVersion: 3, sharedVersion: 3 }),
    share("v2", { status: "acknowledged", acknowledgedVersion: 2, sharedVersion: 2 }),
    share("v6", { sharedVersion: 3 }),
  ];
  const progress = vendorTeamProgress(entries, shares, 3);
  assert.deepEqual(
    { total: progress.total, needed: progress.needed, considering: progress.considering, booked: progress.booked, declined: progress.declined },
    { total: 5, needed: 1, considering: 1, booked: 3, declined: 1 },
  );
  // Only booked vendors count against the budget: not the band they're considering.
  assert.equal(progress.bookedCostCents, 1840000);
  assert.equal(progress.balanceDueCents, 120000);
  assert.equal(progress.tipCents, 10000);
  assert.deepEqual(progress.timeline, { sent: 2, confirmed: 1, older: 1, notSent: 1 });
  assert.equal(progress.teamComplete, false);
  assert.equal(progress.allConfirmed, false);
  assert.equal(timelineSummary(progress), "Sent to 2 · 1 confirmed · 1 has an older version");
  assert.equal(budgetLine(progress.bookedCostCents, 3500000), "$18,400 of $35,000 booked");
  assert.equal(budgetLine(progress.bookedCostCents, null), "$18,400 booked");
  assert.equal(budgetLine(0, null), "No costs booked yet");
});

test("a team is complete when nothing is still needed, and confirmed when every booked vendor has this version", () => {
  const entries = [entry({ entryId: "a", vendorId: "v1" }), entry({ entryId: "b", vendorId: "v2" })];
  const shares = [
    share("v1", { status: "acknowledged", sharedVersion: 4, acknowledgedVersion: 4 }),
    share("v2", { status: "acknowledged", sharedVersion: 4, acknowledgedVersion: 4 }),
  ];
  const progress = vendorTeamProgress(entries, shares, 4);
  assert.equal(progress.teamComplete, true);
  assert.equal(progress.allConfirmed, true);
  assert.equal(timelineSummary(vendorTeamProgress(entries, [], 4)), null);
  assert.equal(vendorTeamProgress([], [], null).teamComplete, false);
});

test("photographers, DJs, makeup and hair keep a quiet team: nothing new on an inquiry or a closed job", () => {
  for (const trade of TRADES) {
    assert.equal(tradeProfile(trade).vendorTeam, "quiet", trade);
    assert.equal(serverTradeProfile(trade).vendorTeam, "quiet", trade);
  }
  assert.equal(vendorTeamVisibility({ mode: "quiet", entryCount: 0, state: "LEAD" }), "hidden");
  assert.equal(vendorTeamVisibility({ mode: "quiet", entryCount: 0, state: "PROPOSAL" }), "hidden");
  assert.equal(vendorTeamVisibility({ mode: "quiet", entryCount: 0, state: "CLOSED" }), "hidden");
  assert.equal(vendorTeamVisibility({ mode: "quiet", entryCount: 0, state: "BOOKED" }), "quiet");
  assert.equal(vendorTeamVisibility({ mode: "quiet", entryCount: 0, state: "PLANNING" }), "quiet");
  // Once a vendor is on the job, the team is there for good.
  assert.equal(vendorTeamVisibility({ mode: "quiet", entryCount: 1, state: "CLOSED" }), "panel");
  assert.equal(vendorTeamVisibility({ mode: "default", entryCount: 0, state: "LEAD" }), "panel");
});

test("the team's categories are the directory's kinds", () => {
  assert.deepEqual([...VENDOR_TEAM_CATEGORIES], [...VENDOR_TYPES]);
});

// ─── The budget ──────────────────────────────────────────────────────────────

test("a budget reads only when it says one amount", () => {
  assert.equal(parseBudgetCents("$35,000"), 3_500_000);
  assert.equal(parseBudgetCents("35k"), 3_500_000);
  assert.equal(parseBudgetCents("about $35,000 total"), 3_500_000);
  assert.equal(parseBudgetCents("35000"), 3_500_000);
  assert.equal(parseBudgetCents("$42.5k"), 4_250_000);
  // The inquiry form's own choices are ranges or open-ended: ambiguous, left for the studio.
  for (const ambiguous of ["$3,000–$5,000", "$5,000-$8,000", "$12,000+", "under 20k", "30k to 40k", "between 20 and 30k", "", "not sure", "$50"]) {
    assert.equal(parseBudgetCents(ambiguous), null, ambiguous);
  }
  assert.equal(parseBudgetCents(null), null);
});

test("no trade today prefills the wedding's budget from its own budget question", () => {
  // "Photographer budget: $5,000–$8,000" is the photos', not the wedding's.
  for (const trade of TRADES) assert.equal(budgetPrefillCents(trade, "$35,000"), null, trade);
});

// ─── Who gets the timeline ───────────────────────────────────────────────────

const vendors = new Map([
  ["v_new", { exists: true, archived: false, email: "rosa@petalandstem.example", company: "Petal & Stem" }],
  ["v_old", { exists: true, archived: false, email: "spins@example.com", company: "Spin Theory" }],
  ["v_same", { exists: true, archived: false, email: "cake@example.com", company: "Sugar Bloom" }],
  ["v_noemail", { exists: true, archived: false, email: null, company: "Barn at Hope" }],
  ["v_gone", { exists: true, archived: true, email: "x@example.com", company: "Gone Co" }],
  ["v_revoked", { exists: true, archived: false, email: "planner@example.com", company: "Wren & Co." }],
]);
const planShares = new Map([
  ["v_old", { status: "acknowledged", revokedAt: null, scheduleId: "sched_v1", scope: "vendor" }],
  ["v_same", { status: "viewed", revokedAt: null, scheduleId: "sched_v2", scope: "full" }],
  ["v_revoked", { status: "revoked", revokedAt: "2026-10-01T00:00:00.000Z", scheduleId: "sched_v1", scope: "vendor" }],
]);
const planEntries = [
  { entryId: "1", vendorId: "v_new", status: "booked", category: "florist" },
  { entryId: "2", vendorId: "v_old", status: "booked", category: "dj" },
  { entryId: "3", vendorId: "v_same", status: "booked", category: "bakery" },
  { entryId: "4", vendorId: "v_noemail", status: "booked", category: "venue" },
  { entryId: "5", vendorId: "v_gone", status: "booked", category: "rentals" },
  { entryId: "6", vendorId: "v_revoked", status: "booked", category: "planner" },
  { entryId: "7", vendorId: "v_considering", status: "considering", category: "band" },
  { entryId: "8", vendorId: null, status: "needed", category: "officiant" },
];

test("send to every vendor: a first link, the update, nothing twice", () => {
  const plan = planVendorTimelineSends({ entries: planEntries, vendors, shares: planShares, currentScheduleId: "sched_v2" });
  const byVendor = Object.fromEntries(plan.map((item) => [item.vendorId, item.action]));
  assert.deepEqual(byVendor, {
    v_new: "new",
    v_old: "update",
    v_same: "current",
    v_noemail: "no_email",
    v_gone: "unavailable",
    v_revoked: "new",
  });
  // A vendor's existing scope is kept; a new link is theirs by kind.
  assert.equal(plan.find((item) => item.vendorId === "v_same")?.scope, "full");
  assert.equal(plan.find((item) => item.vendorId === "v_revoked")?.scope, "full");
  assert.equal(plan.find((item) => item.vendorId === "v_new")?.scope, "vendor");
  // After the send, every link is current: pressing again sends nothing.
  const after = new Map([...planShares].map(([id, value]) => [id, { ...value, status: "sent", revokedAt: null, scheduleId: "sched_v2" }]));
  for (const id of ["v_new", "v_revoked"]) after.set(id, { status: "sent", revokedAt: null, scheduleId: "sched_v2", scope: "vendor" });
  const again = planVendorTimelineSends({ entries: planEntries, vendors, shares: after, currentScheduleId: "sched_v2" });
  assert.deepEqual(again.filter((item) => item.action === "new" || item.action === "update"), []);
  // A republish (version 3) makes them all the update.
  const republished = planVendorTimelineSends({ entries: planEntries, vendors, shares: after, currentScheduleId: "sched_v3" });
  assert.deepEqual(
    republished.filter((item) => item.action === "update").map((item) => item.vendorId).sort(),
    ["v_new", "v_old", "v_revoked", "v_same"],
  );
});

test("a planner and a videographer see the whole day; everyone else their part", () => {
  assert.equal(teamShareScope("planner"), "full");
  assert.equal(teamShareScope("videographer"), "full");
  assert.equal(teamShareScope("florist"), "vendor");
  assert.equal(teamShareScope("dj"), "vendor");
});

test("the crew see who and when, never what the couple pays", () => {
  const contacts = crewVendorContactsFrom([
    { ...entry({ entryId: "b", arrivalTime: "16:00", costCents: 300000, balanceDueCents: 1, tipCents: 2 }), company: "Spin Theory", phone: "555-0102", contactName: "Jay" },
    { ...entry({ entryId: "a", arrivalTime: "14:00", costCents: 420000 }), phone: "555-0101", contactName: "Rosa" },
    { ...entry({ entryId: "c", status: "considering" }), company: "Maybe Band" },
  ]);
  assert.deepEqual(
    contacts.map((contact) => [contact.company, contact.arrivalTime]),
    [
      ["Petal & Stem", "14:00"],
      ["Spin Theory", "16:00"],
    ],
  );
  for (const contact of contacts) {
    assert.ok(!Object.keys(contact).some((key) => /cents|cost|balance|tip/i.test(key)), JSON.stringify(contact));
  }
});

test("the couple's name comes from the job's name as the create form writes it", () => {
  assert.equal(coupleNameOf("Erin & Joe DeMattia Wedding"), "Erin & Joe DeMattia");
  assert.equal(coupleNameOf("Maya Brooks Wedding"), "Maya Brooks");
  assert.equal(coupleNameOf("Acme Corp Summit"), "Acme Corp Summit");
});

// ─── Arrival lines (N2) ──────────────────────────────────────────────────────

const day = { eventDate: "2027-06-12", timeZone: "America/New_York" };
const studioLine = (id: string, clock: string, title: string) => ({
  ...(manualScheduleItem(id, `2027-06-12T${clock}:00-04:00`, title) as unknown as ScheduleItem),
});

test("one arrival line per booked vendor with a time, tagged to them; running it again updates rather than duplicates", () => {
  const items = [studioLine("getting_ready", "13:00", "Getting ready"), studioLine("ceremony", "16:00", "Ceremony")];
  const team = [
    entry({ entryId: "pv_florist", vendorId: "v_petal", arrivalTime: "14:00", loadInTime: "14:30" }),
    entry({ entryId: "pv_dj", vendorId: "v_spin", category: "dj", company: "Spin Theory", loadInTime: "15:00" }),
    entry({ entryId: "pv_band", vendorId: "v_band", category: "band", status: "considering", arrivalTime: "15:00" }),
    entry({ entryId: "pv_cake", vendorId: null, category: "bakery", status: "needed", arrivalTime: "15:00" }),
    entry({ entryId: "pv_venue", vendorId: "v_barn", category: "venue", company: "Barn at Hope" }),
  ];
  const first = vendorArrivalLines(items, team, day);
  assert.deepEqual([first.added, first.updated, first.removed], [2, 0, 0]);
  const florist = first.items.find((item) => item.id === "vendor_arrival_pv_florist") as ScheduleItem;
  assert.equal(florist.title, "Florist arrives — Petal & Stem");
  assert.equal(florist.startAt, "2027-06-12T18:00:00.000Z");
  assert.equal(florist.description, "Load-in 2:30 PM");
  assert.deepEqual(florist.vendorContactIds, ["v_petal"]);
  assert.equal(florist.visibility, "crew");
  assert.equal((first.items.find((item) => item.id === "vendor_arrival_pv_dj") as ScheduleItem).title, "DJ loads in — Spin Theory");
  assert.deepEqual(
    first.items.map((item) => item.id),
    ["getting_ready", "vendor_arrival_pv_florist", "vendor_arrival_pv_dj", "ceremony"],
  );
  // Again, unchanged: nothing added.
  const second = vendorArrivalLines(first.items as ScheduleItem[], team, day);
  assert.deepEqual([second.added, second.updated, second.removed], [0, 0, 0]);
  assert.equal(second.items.length, 4);
  // The florist moves to 1:30, the DJ comes off the team.
  const moved = vendorArrivalLines(
    second.items as ScheduleItem[],
    [entry({ entryId: "pv_florist", vendorId: "v_petal", arrivalTime: "13:30" })],
    day,
  );
  assert.deepEqual([moved.added, moved.updated, moved.removed], [0, 1, 1]);
  assert.deepEqual(
    moved.items.map((item) => item.id),
    ["getting_ready", "vendor_arrival_pv_florist", "ceremony"],
  );
});

test("the vendor sees their arrival through their own link, and nobody else's", () => {
  const { items } = vendorArrivalLines(
    [studioLine("ceremony", "16:00", "Ceremony")],
    [
      entry({ entryId: "pv_florist", vendorId: "v_petal", arrivalTime: "14:00" }),
      entry({ entryId: "pv_dj", vendorId: "v_spin", category: "dj", company: "Spin Theory", arrivalTime: "15:00" }),
    ],
    day,
  );
  const florists = vendorVisibleItems(items as ScheduleItem[], "v_petal", "vendor").map((item) => item.title);
  assert.ok(florists.includes("Florist arrives — Petal & Stem"));
  assert.ok(!florists.includes("DJ arrives — Spin Theory"));
});

test("an arrival marks a moment: it ends nobody's block", () => {
  const items = flowEnds(
    [
      studioLine("getting_ready", "13:00", "Getting ready"),
      { ...studioLine("vendor_arrival_pv_florist", "14:00", "Florist arrives — Petal & Stem") },
      studioLine("ceremony", "16:00", "Ceremony"),
    ],
    new Set(),
    null,
  );
  assert.ok(isVendorArrivalLine(items[1]!));
  assert.equal(items[0]!.endAt, "2027-06-12T20:00:00.000Z", "getting ready still runs to the ceremony");
  assert.equal(items[1]!.endAt, "2027-06-12T18:30:00.000Z");
});

// ─── The email ───────────────────────────────────────────────────────────────

const brand = { studioName: "Wren & Co. Events", productName: "StudioCue", accentColor: "#0f8a5e", logoUrl: null, contactEmail: "hello@example.com" };

test("the vendor's email names the wedding, the date and their link; an update says so", () => {
  const values = {
    shareUrl: "https://studio-cue.com/share/token",
    coupleName: "Maya Brooks",
    eventDate: "2027-06-12",
    eventKind: "wedding",
    venueName: "Barn at Hope",
  };
  const first = renderEmailTemplate({ key: "vendor_timeline", brand, recipientName: "Rosa Diaz", projectName: "Maya Brooks Wedding", values });
  assert.equal(first.subject, "Wren & Co. Events sent you the timeline for Maya Brooks's wedding on June 12, 2027");
  assert.match(first.text, /View and confirm: https:\/\/studio-cue\.com\/share\/token/);
  assert.match(first.text, /Hi Rosa,/);
  const update = renderEmailTemplate({
    key: "vendor_timeline",
    brand,
    recipientName: "Rosa Diaz",
    projectName: "Maya Brooks Wedding",
    values: { ...values, timelineUpdate: true, studioNote: "The ceremony moved to 4:30." },
  });
  assert.equal(update.subject, "Updated timeline: Maya Brooks's wedding on June 12, 2027");
  assert.match(update.text, /The ceremony moved to 4:30\./);
  assert.match(update.text, /earlier link no longer opens/);
});

test("vendor mail is held while the studio's billing is lapsed, and never goes to the couple", () => {
  for (const type of VENDOR_EMAIL_TYPES) assert.equal(billingHoldApplies("emailJobs", type), true, type);
  const source = read("functions/src/planning/vendor-team.ts");
  assert.match(source, /type: "vendor_timeline",\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*audience: "vendor",\s*soleRecipient: true,/);
  // The worker reads `audience` to keep a vendor's copy out of the couple's mail.
  assert.match(read("functions/src/operations/jobs.ts"), /!\["crew", "vendor", "parent"\]\.includes\(String\(document\.get\("audience"\) \?\? ""\)\)/);
});

test("planningCommand runs the team for the studio only", () => {
  const commands = read("functions/src/planning/commands.ts");
  assert.match(commands, /\.\.\.vendorTeamCommands,/);
  assert.match(commands, /isVendorTeamCommand\(parsed\)\) \{[\s\S]{0,200}if \(!internalRoles\.has\(role\)\) throw new Error\("FORBIDDEN"\);/);
});
