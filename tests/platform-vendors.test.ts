import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { mergeSighting, prospectFor, sightingFrom, sightingKey } from "../functions/src/saas/platform-vendors";
import { csvCell, offerStateOf, vendorsCsv, type VendorRow } from "../functions/src/console/handlers/vendors";
import { partnerCandidate, partnerTypeFor, suggestedPartnerCode } from "../features/console/vendor-database";
import { normalizeReferralCode } from "../features/subscriptions/referral-program";
import { CONSOLE_NAV } from "../components/console/nav";

/**
 * StudioCue's vendor database (docs/vendor-network-plan-2026-10-12.md,
 * Phase 4): every booked vendor with an email, once across all studios,
 * business contact only, counted without ever naming the job.
 */

const read = (path: string) => readFileSync(path, "utf8");
const AT = "2026-10-13T12:00:00.000Z";

const entry = (overrides: Record<string, unknown> = {}) => ({
  tenantId: "gr",
  projectId: "maya_brooks_2027",
  vendorId: "v1",
  status: "booked",
  category: "dj",
  company: "Sound Wave DJs",
  contactName: "Dee",
  email: "Dee@SoundWave.co",
  phone: "908 555 0117",
  archivedAt: null,
  ...overrides,
});
const project = { tenantId: "gr", venue: { region: "NJ", city: "Morristown" }, venueName: "The Grand Barn", name: "Maya Brooks Wedding" };

test("a booked vendor with a real address is recorded; nobody else is", () => {
  const sighting = sightingFrom({ entry: entry(), project, vendor: { website: "https://soundwave.co" }, plannerTrade: false, at: AT });
  assert.ok(sighting);
  assert.equal(sighting.email, "dee@soundwave.co");
  assert.equal(sighting.kind, "dj");
  assert.equal(sighting.region, "NJ");
  assert.equal(sighting.city, "Morristown");
  assert.equal(sighting.website, "https://soundwave.co");
  assert.equal(sighting.source, "studio");
  for (const skipped of [
    entry({ status: "considering" }),
    entry({ status: "needed", email: null }),
    entry({ archivedAt: AT }),
    entry({ email: "not an address" }),
    entry({ email: "dj@example.com" }),
  ])
    assert.equal(sightingFrom({ entry: skipped, project, vendor: null, plannerTrade: false, at: AT }), null);
});

test("who put them there: the couple, the couple's form, a planner or a studio", () => {
  const source = (overrides: Record<string, unknown>, plannerTrade = false) =>
    sightingFrom({ entry: entry(overrides), project, vendor: null, plannerTrade, at: AT })?.source;
  assert.equal(source({ source: "couple" }), "couple");
  assert.equal(source({ source: "client_form" }), "client_form");
  assert.equal(source({}, true), "planner");
  assert.equal(source({}), "studio");
});

test("never the couple, the date or the venue: jobs and studios are one-way keys", () => {
  const sighting = sightingFrom({ entry: entry(), project, vendor: null, plannerTrade: false, at: AT })!;
  const record = mergeSighting(null, sighting);
  const stored = JSON.stringify(record);
  for (const secret of ["maya_brooks_2027", "Maya", "Grand Barn", "2027", "gr\""]) assert.ok(!stored.includes(secret), secret);
  assert.equal(sighting.projectKey, sightingKey("gr:maya_brooks_2027"));
  assert.match(sighting.projectKey, /^[0-9a-f]{20}$/);
});

test("counting: the same job twice counts once; another job, another studio, count", () => {
  const first = sightingFrom({ entry: entry(), project, vendor: null, plannerTrade: false, at: "2026-10-01T00:00:00.000Z" })!;
  let record = mergeSighting(null, first);
  record = mergeSighting(record, first);
  assert.equal(record.jobsSeen, 1);
  assert.equal(record.studiosSeen, 1);
  const secondJob = sightingFrom({ entry: entry({ projectId: "p2", company: "Sound Wave DJ Co" }), project, vendor: null, plannerTrade: false, at: "2026-10-05T00:00:00.000Z" })!;
  record = mergeSighting(record, secondJob);
  assert.equal(record.jobsSeen, 2);
  assert.equal(record.studiosSeen, 1);
  // The newest details win.
  assert.equal(record.company, "Sound Wave DJ Co");
  const otherStudio = sightingFrom({ entry: entry({ tenantId: "other", projectId: "p9", company: "" }), project: { ...project, tenantId: "other" }, vendor: null, plannerTrade: false, at: "2026-09-01T00:00:00.000Z" })!;
  record = mergeSighting(record, otherStudio);
  assert.equal(record.studiosSeen, 2);
  // An older sighting doesn't move "last seen" or blank a detail, and moves "first seen" back.
  assert.equal(record.company, "Sound Wave DJ Co");
  assert.equal(record.lastSeenAt, "2026-10-05T00:00:00.000Z");
  assert.equal(record.firstSeenAt, "2026-09-01T00:00:00.000Z");
});

test("prospects: a vendor-plan trade, a photographer or videographer, or a kind with no journey yet", () => {
  assert.equal(prospectFor(["dj"]), "vendor_plan");
  assert.equal(prospectFor(["hair_makeup"]), "vendor_plan");
  assert.equal(prospectFor(["planner"]), "vendor_plan");
  assert.equal(prospectFor(["videographer"]), "studio_plan");
  assert.equal(prospectFor(["photographer"]), "studio_plan");
  assert.equal(prospectFor(["florist", "caterer"]), "held");
  assert.equal(prospectFor(["florist", "dj"]), "vendor_plan");
});

test("where each stands with the offer", () => {
  assert.equal(offerStateOf(null, false), "none");
  assert.equal(offerStateOf({ tenantId: "gr" }, false), "invited");
  assert.equal(offerStateOf({ tenantId: "gr", offerCode: "VOABCD2345" }, false), "offered");
  assert.equal(offerStateOf({ offerCode: "VOABCD2345" }, true), "opted_out");
  assert.equal(offerStateOf({ offerCode: "VOABCD2345", offerClaimedTenantId: "t9" }, false), "claimed");
  assert.equal(offerStateOf({ offerCode: "VOABCD2345", signedUpTenantId: "t9" }, true), "signed_up");
});

test("the export is plain CSV a spreadsheet won't run", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("+1 908 555 0117"), "'+1 908 555 0117");
  assert.equal(csvCell("Petal, Stem"), '"Petal, Stem"');
  assert.equal(csvCell(null), "");
  const row = { company: "Sound Wave", email: "dee@soundwave.co", jobsSeen: 3, studiosSeen: 2 } as unknown as VendorRow;
  const csv = vendorsCsv([row]);
  assert.match(csv, /^Company,Contact,Email,Phone,Website,Kind,State,City,Jobs,Studios,Prospect,Offer,First seen,Last seen\n/);
  assert.match(csv, /Sound Wave,,dee@soundwave\.co/);
});

test("a vendor working with studios is one click from a partner code", () => {
  assert.equal(partnerTypeFor("hair_makeup"), "makeup");
  assert.equal(partnerTypeFor("planner"), "planner");
  assert.equal(partnerTypeFor("florist"), "other");
  const code = suggestedPartnerCode("Sound Wave DJs, LLC", null);
  assert.equal(code, "SOUNDWAVEDJS");
  assert.equal(normalizeReferralCode(code), code);
  assert.equal(partnerCandidate({ prospect: "vendor_plan", studiosSeen: 3, offer: "offered" }), true);
  assert.equal(partnerCandidate({ prospect: "vendor_plan", studiosSeen: 3, offer: "signed_up" }), false);
  assert.equal(partnerCandidate({ prospect: "held", studiosSeen: 3, offer: "none" }), false);
});

test("wired: the trigger, the handlers, no browser read, the page, the nav and the backfill", () => {
  assert.match(read("functions/src/index.ts"), /export \{ platformVendorOnTeamWritten \} from "\.\/saas\/platform-vendors\.js"/);
  const handlers = read("functions/src/console/handlers/index.ts");
  assert.match(handlers, /\.\.\.vendorHandlers/);
  const vendors = read("functions/src/console/handlers/vendors.ts");
  assert.match(vendors, /listPlatformVendors: consoleHandler\(\{\s*capability: "console\.read"/);
  assert.match(vendors, /exportPlatformVendors: consoleHandler\(\{\s*capability: "crm\.write"/);
  assert.match(read("firestore.rules"), /match \/platformVendors\/\{emailHash\} \{\s*allow read, write: if false;/);
  assert.ok(existsSync("app/platform-admin/vendors/page.tsx"));
  const grow = CONSOLE_NAV.find((group) => group.group === "Grow");
  assert.ok(grow?.items.some((item) => item.href === "/platform-admin/vendors" && item.label === "Vendors"));
  const backfill = read("scripts/backfill-platform-vendors.mts");
  assert.match(backfill, /Refusing to run/);
  assert.match(backfill, /if \(!write\)/);
});

test("the export uses the Console's words for prospect and offer", async () => {
  const { CSV_OFFER_LABELS, CSV_PROSPECT_LABELS } = await import("../functions/src/console/handlers/vendors");
  const { OFFER_STATE_LABELS, PROSPECT_LABELS } = await import("../features/console/vendor-database");
  assert.deepEqual(CSV_OFFER_LABELS, OFFER_STATE_LABELS);
  assert.deepEqual(CSV_PROSPECT_LABELS, PROSPECT_LABELS);
  const csv = vendorsCsv([{ company: "Petal & Stem", prospect: "held", offer: "opted_out" } as unknown as VendorRow]);
  assert.match(csv, /No journey yet,Opted out/);
});
