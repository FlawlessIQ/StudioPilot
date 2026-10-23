import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STUDIO_ONLY_ENTRY_FIELDS,
  coupleRemovalFor,
  removedCoupleEntryFor,
  studioWorkOnCoupleEntry,
  type CoupleVendorRow,
} from "../features/vendors/couple-team";
import {
  crewVendorContactsFrom,
  noEmailPublishWarning,
  removedByClient,
  vendorArrivalLines,
  vendorContactSheet,
  vendorTeamProgress,
} from "../features/vendors/team";
import { paymentsToHandOut } from "../features/vendors/hand-out";
import { paymentsToHandOut as serverPaymentsToHandOut } from "../functions/src/planning/hand-out";
import {
  crewVendorContactsFrom as serverCrewVendorContactsFrom,
  planVendorTimelineSends,
} from "../functions/src/planning/vendor-team";
import { vendorCredits } from "../functions/src/planning/vendor-credits";
import { vendorSectionLines } from "../functions/src/planning/vendor-section";
import { teamReadiness } from "../functions/src/planning/team-readiness";
import { sightingFrom } from "../functions/src/saas/platform-vendors";

/**
 * A client re-sending their vendor list never hard-deletes the studio's work
 * on those vendors (audit 2026-10-22). A couple-listed entry no longer on
 * their list is deleted only while it is exactly what the couple sent; once
 * the studio has worked on it, it is marked `removedByClientAt` and kept,
 * labeled for the studio, and left out of every send and count until the
 * studio keeps them on or takes them off. Listing them again clears the mark.
 */

const read = (path: string) => readFileSync(path, "utf8");

/** A couple-listed entry exactly as the portal creates it (server/vendors/couple-team.ts). */
const coupleEntry = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "job1_pv_dj",
  entryId: "pv_dj",
  tenantId: "t1",
  projectId: "job1",
  vendorId: "vendor_dj",
  category: "dj",
  roleLabel: null,
  status: "booked",
  arrivalTime: null,
  loadInTime: null,
  strikeTime: null,
  contractReceived: false,
  coiReceived: false,
  costCents: null,
  balanceDueCents: null,
  balanceDueDate: null,
  tipCents: null,
  notes: null,
  company: "Night Owl Sound",
  contactName: "Sam",
  email: "sam@nightowl.example.test",
  phone: "9085550188",
  source: "couple",
  createdBy: "client_uid",
  updatedBy: "client_uid",
  archivedAt: null,
  ...fields,
});
const row = (fields: Partial<CoupleVendorRow>): CoupleVendorRow => ({
  entryId: null,
  category: "dj",
  company: "Night Owl Sound",
  contactName: "",
  email: null,
  phone: null,
  ...fields,
});
const REMOVED = { removedByClientAt: "2026-10-22T15:00:00.000Z", removedByClientBy: "client_uid" };

// ─── What counts as the studio's work ────────────────────────────────────────

test("an entry exactly as the couple sent it is deleted when they take it off", () => {
  assert.deepEqual(studioWorkOnCoupleEntry(coupleEntry()), []);
  assert.equal(coupleRemovalFor(coupleEntry()), "delete");
  // A second partner's save is still the couple's.
  assert.equal(coupleRemovalFor(coupleEntry({ updatedBy: "partner_uid" }), { updatedByStudio: false }), "delete");
});

test("any studio-only field set keeps the entry: marked, never deleted", () => {
  const set: Record<(typeof STUDIO_ONLY_ENTRY_FIELDS)[number], unknown> = {
    roleLabel: "Ceremony and reception",
    arrivalTime: "15:00",
    loadInTime: "14:30",
    strikeTime: "23:30",
    contractReceived: true,
    coiReceived: true,
    costCents: 180_000,
    balanceDueCents: 90_000,
    balanceDueDate: "2027-06-01",
    tipCents: 10_000,
    notes: "Needs a 20A circuit by the dance floor.",
  };
  for (const [field, value] of Object.entries(set)) {
    const entry = coupleEntry({ [field]: value });
    assert.deepEqual(studioWorkOnCoupleEntry(entry), [field], field);
    assert.equal(coupleRemovalFor(entry), "mark", field);
  }
  // A cost of $0 the studio typed is still the studio's work.
  assert.equal(coupleRemovalFor(coupleEntry({ costCents: 0 })), "mark");
  // Blank notes and unticked boxes are not.
  assert.equal(coupleRemovalFor(coupleEntry({ notes: "  ", contractReceived: false })), "delete");
});

test("a studio save, a timeline link sent, or a changed status keeps the entry too", () => {
  assert.equal(coupleRemovalFor(coupleEntry({ studioTouchedAt: "2026-10-20T10:00:00.000Z" })), "mark");
  assert.equal(coupleRemovalFor(coupleEntry({ updatedBy: "owner_uid" }), { updatedByStudio: true }), "mark");
  assert.equal(coupleRemovalFor(coupleEntry(), { liveShare: true }), "mark");
  assert.deepEqual(studioWorkOnCoupleEntry(coupleEntry({ status: "considering" })), ["status"]);
  assert.deepEqual(studioWorkOnCoupleEntry(coupleEntry({ costCents: 5000 }), { liveShare: true }), ["costCents", "timeline_link"]);
});

test("an entry already marked is left as it was: the first removal's date stands", () => {
  assert.equal(coupleRemovalFor(coupleEntry({ ...REMOVED, costCents: 5000 })), "already_marked");
  assert.equal(coupleRemovalFor(coupleEntry(REMOVED)), "already_marked");
});

// ─── Listing them again ──────────────────────────────────────────────────────

test("re-adding the same vendor finds the kept entry instead of making a second one", () => {
  const kept = { id: "pv_dj", data: coupleEntry({ ...REMOVED, costCents: 180_000 }) };
  const other = { id: "pv_florist", data: coupleEntry({ entryId: "pv_florist", category: "florist", company: "Petal & Stem", email: "rosa@petal.example.test", phone: null }) };
  const entries = [other, kept];
  // The same email, whatever else changed.
  assert.equal(removedCoupleEntryFor(row({ company: "Night Owl DJs", email: "SAM@nightowl.example.test" }), entries), kept);
  // The same phone (their key), written differently.
  assert.equal(removedCoupleEntryFor(row({ company: "Night Owl", phone: "(908) 555-0188" }), entries), kept);
  // The same business by kind, with new contact details.
  assert.equal(removedCoupleEntryFor(row({ company: "night  owl sound", phone: "2125550100" }), entries), kept);
  // Someone else entirely: a new entry.
  assert.equal(removedCoupleEntryFor(row({ company: "Spin Theory", email: "jay@spin.example.test" }), entries), null);
});

test("only a couple entry kept after their removal comes back that way", () => {
  const live = { id: "pv_dj", data: coupleEntry() };
  const studios = { id: "pv_s", data: coupleEntry({ ...REMOVED, source: "studio" }) };
  const archived = { id: "pv_a", data: coupleEntry({ ...REMOVED, archivedAt: "2026-10-01T00:00:00.000Z" }) };
  assert.equal(removedCoupleEntryFor(row({ email: "sam@nightowl.example.test" }), [live, studios, archived]), null);
});

// ─── Readers leave a removed entry out of every send and count ──────────────

const team = [
  coupleEntry({ ...REMOVED, entryId: "pv_dj", arrivalTime: "15:00", costCents: 180_000, balanceDueCents: 90_000, tipCents: 10_000, email: "" }),
  coupleEntry({
    id: "job1_pv_florist",
    entryId: "pv_florist",
    vendorId: "vendor_florist",
    category: "florist",
    company: "Petal & Stem",
    email: "rosa@petal.example.test",
    arrivalTime: "13:30",
    costCents: 420_000,
    balanceDueCents: 120_000,
    tipCents: 5_000,
  }),
];

test("removedByClient reads the mark", () => {
  assert.equal(removedByClient(team[0]), true);
  assert.equal(removedByClient(team[1]), false);
  assert.equal(removedByClient({ removedByClientAt: null }), false);
  assert.equal(removedByClient(null), false);
});

test("the studio's counts, budget and readiness leave the removed vendor out, and count it apart", () => {
  const progress = vendorTeamProgress(team, [], null);
  assert.equal(progress.booked, 1);
  assert.equal(progress.total, 1);
  assert.equal(progress.removedByClient, 1);
  assert.equal(progress.bookedCostCents, 420_000);
  assert.deepEqual(teamReadiness(team, [], null), { vendorTeamComplete: progress.teamComplete, vendorsConfirmed: progress.allConfirmed });
  // A removed vendor confirming an old link doesn't stand for the team either.
  const onlyRemoved = [team[0]!];
  assert.equal(vendorTeamProgress(onlyRemoved, [], null).teamComplete, false);
  assert.equal(teamReadiness(onlyRemoved, [], null).vendorTeamComplete, false);
});

test("no timeline send, no contact sheet, no crew view, no arrival line for a removed vendor", () => {
  const plan = planVendorTimelineSends({
    entries: team.map((entry) => ({
      entryId: String(entry.entryId),
      vendorId: String(entry.vendorId),
      status: String(entry.status),
      category: String(entry.category),
      archivedAt: entry.archivedAt,
      removedByClientAt: entry.removedByClientAt,
    })),
    vendors: new Map([
      ["vendor_dj", { exists: true, archived: false, email: "sam@nightowl.example.test", company: "Night Owl Sound" }],
      ["vendor_florist", { exists: true, archived: false, email: "rosa@petal.example.test", company: "Petal & Stem" }],
    ]),
    shares: new Map(),
    currentScheduleId: "schedule_v1",
  });
  assert.deepEqual(plan.map((item) => item.vendorId), ["vendor_florist"]);

  assert.deepEqual(vendorContactSheet(team).map((line) => line.company), ["Petal & Stem"]);
  assert.deepEqual(crewVendorContactsFrom(team).map((line) => line.company), ["Petal & Stem"]);
  assert.deepEqual(crewVendorContactsFrom(team), serverCrewVendorContactsFrom(team));

  const lines = vendorArrivalLines([], team, { eventDate: "2027-06-12", timeZone: "America/New_York" });
  assert.deepEqual(lines.items.map((item) => item.id), ["vendor_arrival_pv_florist"]);
  // A line it made before the removal comes off on the next run.
  const again = vendorArrivalLines(
    [{ id: "vendor_arrival_pv_dj", startAt: "2027-06-12T19:00:00.000Z" }],
    team,
    { eventDate: "2027-06-12", timeZone: "America/New_York" },
  );
  assert.equal(again.removed, 1);

  // The removed DJ has no email; it isn't the publish warning's business.
  assert.equal(noEmailPublishWarning(team), null);
});

test("no envelope on the day, no credit, no form line, no platform sighting for a removed vendor", () => {
  const handOut = paymentsToHandOut(team, "2027-06-12");
  assert.deepEqual(handOut.lines.map((line) => line.who), ["Petal & Stem (Florist)"]);
  assert.deepEqual(serverPaymentsToHandOut(team, "2027-06-12"), handOut);

  const credits = vendorCredits({ entries: team, vendors: new Map(), studio: { name: "GR Productions", category: "Planning" } });
  assert.ok(!credits.some((line) => line.company === "Night Owl Sound"));
  assert.ok(credits.some((line) => line.company === "Petal & Stem"));

  assert.doesNotMatch(vendorSectionLines(team), /Night Owl/);
  assert.match(vendorSectionLines(team), /Petal & Stem/);

  const at = "2026-10-22T15:00:00.000Z";
  assert.equal(sightingFrom({ entry: team[0]!, project: {}, vendor: null, plannerTrade: false, at }), null);
});

// ─── Where it is written (source pins) ──────────────────────────────────────

test("the couple's save deletes only an untouched entry, marks a touched one, and clears the mark on a re-add", () => {
  const source = read("server/vendors/couple-team.ts");
  // The only delete in the save is the untouched case.
  assert.equal(source.match(/transaction\.delete\(/g)?.length, 1);
  assert.match(source, /if \(removal\.action === "delete"\) transaction\.delete\(entry\.ref\);/);
  assert.match(source, /action: coupleRemovalFor\(entry\.data\(\) \?\? \{\}, context\)/);
  assert.match(source, /removedByClientAt: now,\s+removedByClientBy: uid,/);
  // A studio member's earlier save is learned from their membership, not guessed.
  assert.match(source, /memberships\/\$\{tenantId\}_\$\{writer\}/);
  assert.match(source, /membership\.get\("role"\) === "client"/);
  // Listed again: the kept entry is found and its mark cleared.
  assert.match(source, /removedCoupleEntryFor\(row, coupleEntryList\)\?\.entry/);
  assert.match(source, /removedByClient\(item\.existing\.data\(\)\) \? \{ removedByClientAt: null, removedByClientBy: null \}/);
  // An entry already marked isn't marked (or deleted) again.
  assert.match(source, /!removedByClient\(entry\.data\(\)\),\s+\);/);
  // The couple's own view no longer lists it.
  assert.match(source, /!entry\.get\("archivedAt"\) && !removedByClient\(entry\.data\(\)\) && entry\.get\("status"\) === "booked"/);
  // Their link to the couple's day stops opening either way.
  assert.match(source, /revokedReason: "removed_by_client"/);
});

test("the studio keeps them on with its own command, and its saves are stamped", () => {
  const source = read("functions/src/planning/vendor-team.ts");
  assert.match(source, /type: z\.literal\("keepVendorTeamEntry"\)/);
  assert.match(source, /case "keepVendorTeamEntry":\s+return keepEntry\(db, parsed, context\);/);
  assert.match(source, /removedByClientAt: null,\s+removedByClientBy: null,/);
  assert.match(source, /projectIds: FieldValue\.arrayUnion\(projectId\)/);
  assert.match(source, /current\.get\("studioTouchedAt"\) \? \{\} : \{ studioTouchedAt: context\.now \}/);
  // A plain save never clears the couple's removal.
  const update = source.slice(source.indexOf("async function addOrUpdateEntry"), source.indexOf("async function removeEntry"));
  assert.doesNotMatch(update, /removedByClientAt/);
});

test("the studio sees it, labeled, with Keep and Take off in the entry's sheet", () => {
  const panel = read("components/vendors/vendor-team-panel.tsx");
  assert.match(panel, /`Removed by \$\{client\}`/);
  assert.match(panel, /!entry\.archivedAt && !removedByClient\(entry\)\);/);
  const sheet = read("components/vendors/vendor-team-sheet.tsx");
  assert.match(sheet, /sendPlanningCommand\("keepVendorTeamEntry"/);
  assert.match(sheet, /Keep them on the team/);
  assert.match(sheet, /no timeline, schedule link or vendor email/);
});

test("every other reader of the team leaves a removed entry out", () => {
  const pins: Array<[string, RegExp]> = [
    ["functions/src/operations/ai-pdf.ts", /!entry\.archivedAt&&!entry\.removedByClientAt&&entry\.status==="booked"/],
    ["functions/src/planning/job-facts.ts", /!entry\.data\.archivedAt && !entry\.data\.removedByClientAt/],
    ["server/planning/final-details.ts", /!entry\.get\("removedByClientAt"\)/],
    ["components/vendors/vendor-contact-sheet.tsx", /!entry\.archivedAt && !removedByClient\(entry\)/],
    ["components/planning/ai-schedule-generator.tsx", /!removedByClient\(entry\) &&/],
  ];
  for (const [path, pattern] of pins) assert.match(read(path), pattern, path);
});
