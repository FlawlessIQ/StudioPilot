import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  coupleVendorAnswer,
  coupleVendorAsk,
  coupleVendorKey,
  coupleVendorKinds,
  coupleVendorRowSchema,
  coupleVendorSubmissionSchema,
  coupleVendorsNeedStudio,
  dedupeCoupleVendors,
  normalizePhone,
  vendorSuggestionsFromAnswers,
  type CoupleVendorRow,
} from "../features/vendors/couple-team";
import { crewVendorContactsFrom } from "../features/vendors/team";
import { crewVendorContactsFrom as serverCrewVendorContactsFrom } from "../functions/src/planning/vendor-team";
import { DEFAULT_PLANNING_TIMELINE } from "../features/planning/planning-timeline";
import { buildClientPortalExperience } from "../server/client/portal-experience";
import { clientAreaItems } from "../features/client/portal-navigation";
import { todayInbox } from "../features/today/inbox";

/**
 * The couple lists their other vendors in the portal
 * (docs/vendor-network-plan-2026-10-12.md, Phase 1).
 */

const read = (path: string) => readFileSync(path, "utf8");
const timeline = DEFAULT_PLANNING_TIMELINE;
const wedding = { state: "BOOKED", eventKind: "wedding", eventDate: "2027-06-12" };
const row = (fields: Partial<CoupleVendorRow>): CoupleVendorRow => ({
  entryId: null,
  category: "dj",
  company: "Night Owl Sound",
  contactName: "",
  email: null,
  phone: null,
  ...fields,
});

test("asked of a booked wedding from the planning form's day, due on the lock day", () => {
  const before = coupleVendorAsk({ project: wedding, timeline, today: "2026-11-01" });
  assert.equal(before.available, true);
  assert.equal(before.open, false);
  assert.equal(before.opensOn, "2026-12-12");
  assert.equal(before.dueDate, "2027-05-15");
  assert.equal(coupleVendorAsk({ project: wedding, timeline, today: "2026-12-12" }).open, true);
  // The planning form went out early: the ask goes with it.
  assert.equal(coupleVendorAsk({ project: wedding, timeline, today: "2026-11-01", planningFormSent: true }).open, true);
  // Past the lock day: still open, nothing due.
  const late = coupleVendorAsk({ project: wedding, timeline, today: "2027-05-20" });
  assert.equal(late.open, true);
  assert.equal(late.dueDate, null);
});

test("never asked: an inquiry, a portrait session, an imported or paused job, the day itself, or a planner-run one", () => {
  const today = "2027-01-10";
  assert.equal(coupleVendorAsk({ project: { ...wedding, state: "INQUIRY" }, timeline, today }).available, false);
  assert.equal(coupleVendorAsk({ project: { ...wedding, eventKind: "portraits" }, timeline, today }).available, false);
  assert.equal(coupleVendorAsk({ project: { ...wedding, importedAt: "2026-09-01T00:00:00Z" }, timeline, today }).available, false);
  assert.equal(coupleVendorAsk({ project: { ...wedding, clientAutomationsPausedAt: "2026-09-01T00:00:00Z" }, timeline, today }).available, false);
  assert.equal(coupleVendorAsk({ project: wedding, timeline, today: "2027-06-12" }).available, false);
  assert.equal(coupleVendorAsk({ project: { ...wedding, vendorTeamByPlanner: true }, timeline, today }).available, false);
  // A planning studio builds the team itself; every other trade's couple is asked.
  assert.equal(coupleVendorAsk({ project: wedding, timeline, today, trade: "planner" }).available, false);
  for (const trade of ["photographer", "dj", "makeup", "hair", null]) assert.equal(coupleVendorAsk({ project: wedding, timeline, today, trade }).available, true);
});

test("the studio's own trade is left off its client's list", () => {
  assert.ok(!coupleVendorKinds("dj").includes("dj"));
  assert.ok(coupleVendorKinds("dj").includes("photographer"));
  assert.ok(!coupleVendorKinds(undefined).includes("photographer"));
  assert.ok(coupleVendorKinds(undefined).includes("videographer"));
  // A hair stylist's client may have a separate makeup artist.
  assert.ok(coupleVendorKinds("hair").includes("hair_makeup"));
});

test("a row needs an email or a phone; blanks read as none", () => {
  assert.equal(coupleVendorRowSchema.safeParse(row({})).success, false);
  assert.equal(coupleVendorRowSchema.safeParse({ ...row({}), email: "", phone: "  " }).success, false);
  const parsed = coupleVendorRowSchema.parse({ ...row({}), email: "", phone: "555-010-0199" });
  assert.equal(parsed.email, null);
  assert.equal(coupleVendorRowSchema.safeParse({ ...row({}), email: "not an email" }).success, false);
  assert.equal(coupleVendorSubmissionSchema.safeParse({ answer: "none", vendors: [] }).success, true);
  assert.equal(coupleVendorSubmissionSchema.safeParse({ answer: "listed", vendors: [] }).success, false);
});

test("one vendor once: same email, or same phone however it's written", () => {
  assert.equal(normalizePhone("+1 (555) 010-0199"), "5550100199");
  assert.equal(coupleVendorKey(row({ phone: "(555) 010-0199" })), coupleVendorKey(row({ phone: "555.010.0199", company: "Other" })));
  const rows = dedupeCoupleVendors([
    row({ email: "Hello@NightOwl.com" }),
    row({ email: "hello@nightowl.com", contactName: "Sam", phone: "5550100199" }),
    row({ category: "florist", company: "Bloom", phone: "5550100100" }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.email, "hello@nightowl.com");
  assert.equal(rows[0]!.contactName, "Sam");
  assert.equal(rows[0]!.phone, "5550100199");
});

test("vendors already named in a form are offered, never a 'no' or 'TBD'", () => {
  const suggestions = vendorSuggestionsFromAnswers(
    [
      { label: "Planner or coordinator", value: "Claire Events - claire@example.com" },
      { label: "Videographer", value: "TBD" },
      { label: "Florist", value: "n/a" },
      { label: "DJ or band", value: "Night Owl Sound" },
      { label: "Ceremony address", value: "12 Main St" },
    ],
    [{ category: "dj", company: "Night Owl Sound" }],
  );
  assert.deepEqual(suggestions, [{ category: "planner", company: "Claire Events" }]);
});

test("the answer, and Today until the studio opens it", () => {
  assert.equal(coupleVendorAnswer(null), "unanswered");
  assert.equal(coupleVendorAnswer({ answer: "none", receivedAt: "2027-01-01T00:00:00Z" }), "none");
  const listed = { id: "p1", projectId: "p1", answer: "listed", count: 3, receivedAt: "2027-01-02T10:00:00Z", studioSeenAt: null };
  assert.equal(coupleVendorsNeedStudio(listed), true);
  assert.equal(coupleVendorsNeedStudio({ ...listed, studioSeenAt: "2027-01-02T11:00:00Z" }), false);
  assert.equal(coupleVendorsNeedStudio({ ...listed, answer: "none" }), false);

  const inbox = todayInbox({
    now: "2027-01-03T12:00:00.000Z",
    projects: [{ id: "p1", name: "Avery & Sam", state: "PLANNING", eventDate: "2027-06-12" }],
    clientVendorTeams: [listed],
  } as never) as unknown as { act: Array<{ id: string; title: string; jobHref: string; action: { kind: string } }> };
  const item = inbox.act.find((entry) => entry.id === "couple-vendors-p1");
  assert.ok(item);
  assert.equal(item!.title, "Avery & Sam listed 3 vendors");
  assert.equal(item!.action.kind, "couple_vendors");
});

test("the portal: their next step once the planning form is in, never ahead of it", () => {
  const open = { open: true, answered: false, dueDate: "2027-05-15" };
  const asked = buildClientPortalExperience({ state: "PLANNING", availability: {}, checkpoints: [], vendorTeam: open } as never);
  assert.equal(asked.nextClientAction.href, "/client/vendors");
  assert.equal(asked.navigation.vendorTeam, true);
  const formFirst = buildClientPortalExperience({
    state: "PLANNING",
    availability: {},
    checkpoints: [],
    planningForm: { dueDate: "2027-01-01" },
    vendorTeam: open,
  } as never);
  assert.notEqual(formFirst.nextClientAction.href, "/client/vendors");
  const answered = buildClientPortalExperience({ state: "PLANNING", availability: {}, checkpoints: [], vendorTeam: { ...open, answered: true } } as never);
  assert.notEqual(answered.nextClientAction.href, "/client/vendors");
  assert.equal(answered.navigation.vendorTeam, true);
  assert.ok(clientAreaItems(answered.navigation).some((item) => item.href === "/client/vendors"));
});

test("the crew's view of the team is the same rule on both sides of the boundary", () => {
  const entries = [
    { entryId: "a", category: "dj", company: "Night Owl", status: "booked", phone: "555", arrivalTime: "15:00", costCents: 100000 },
    { entryId: "b", category: "florist", company: "Bloom", status: "booked", loadInTime: "11:00" },
    { entryId: "c", category: "caterer", company: "Feast", status: "considering" },
  ];
  assert.deepEqual(crewVendorContactsFrom(entries), serverCrewVendorContactsFrom(entries));
  assert.ok(!JSON.stringify(crewVendorContactsFrom(entries)).includes("100000"));
});

test("wired: the portal route saves it, the studio reads it, nobody writes it from a browser", () => {
  assert.match(read("app/api/client/portal/route.ts"), /submit_vendor_team/);
  assert.match(
    read("firestore.rules"),
    /match \/clientVendorTeams\/\{projectId\} \{\s*allow read: if canManageProjects\(resource\.data\.tenantId\);\s*allow write: if false;/,
  );
  assert.match(read("components/live/tenant-records.tsx"), /"clientVendorTeams"/);
  assert.match(read("functions/src/planning/vendor-team.ts"), /markCoupleVendorsSeen/);
  // A couple's entry is marked as theirs, the studio's as the studio's.
  assert.match(read("server/vendors/couple-team.ts"), /source: "couple"/);
  assert.match(read("functions/src/planning/vendor-team.ts"), /source: "studio"/);
});

test("the planning form's emails carry the vendor ask only while the couple owes it", async () => {
  const { vendorAskOwed } = await import("../functions/src/planning/vendor-team");
  const { renderEmailTemplate } = await import("../functions/src/communications/email-templates");
  const project = { state: "BOOKED", eventKind: "wedding", eventDate: "2027-06-12" };
  const today = "2027-01-10";
  assert.equal(vendorAskOwed({ project, trade: "photographer", answered: false, today }), true);
  assert.equal(vendorAskOwed({ project, trade: "photographer", answered: true, today }), false);
  assert.equal(vendorAskOwed({ project, trade: "planner", answered: false, today }), false);
  assert.equal(vendorAskOwed({ project: { ...project, vendorTeamByPlanner: true }, trade: "dj", answered: false, today }), false);
  assert.equal(vendorAskOwed({ project: { ...project, importedAt: "2026-09-01T00:00:00Z" }, trade: "dj", answered: false, today }), false);
  assert.equal(vendorAskOwed({ project: { ...project, eventKind: "portraits" }, trade: "photographer", answered: false, today }), false);
  assert.equal(vendorAskOwed({ project, trade: "hair", answered: false, today: "2027-06-12" }), false);

  const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const render = (values: Record<string, unknown>) =>
    renderEmailTemplate({ key: "questionnaire_reminder", brand, recipientName: "Maya", projectName: "Maya Brooks Wedding", values } as never);
  assert.match(render({ vendorTeamAsk: true, actionUrl: "https://studio-cue.com/client" }).text, /other vendors working your day/);
  assert.doesNotMatch(render({ vendorTeamAsk: false, actionUrl: "https://studio-cue.com/client" }).text, /other vendors/);
});
