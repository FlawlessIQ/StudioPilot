import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";
import { todayInbox } from "@/features/today/inbox";
import { coiDue, coiRequestIds, venueKey } from "../functions/src/coi/automation";
import { chaseDecision } from "../functions/src/planning/coi-chase-scheduler";
import { fillsFor, type InquiryExtraction } from "../functions/src/intake/enrich";

/**
 * H3 — certificates of insurance on autopilot
 * (docs/coi-automation-plan-2026-09-28.md). Asked for on time, chased, brought
 * back for one approval, and never counted done until the venue has it.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2027-04-01T14:00:00.000Z");

test("a certificate is asked for no earlier than the lead time, due two weeks out", () => {
  const early = coiDue("2027-09-18", 60, "2027-04-01T14:00:00.000Z");
  assert.equal(early.askFrom, "2027-07-20");
  assert.equal(early.timeToAsk, false, "a year out, a certificate can show a policy that renews first");
  assert.equal(early.dueDate, "2027-09-04");

  const onTime = coiDue("2027-09-18", 60, "2027-07-20T14:00:00.000Z");
  assert.equal(onTime.timeToAsk, true);

  // Booked ten days out: due no sooner than two days from now.
  const late = coiDue("2027-04-11", 60, "2027-04-01T14:00:00.000Z");
  assert.equal(late.timeToAsk, true);
  assert.equal(late.dueDate, "2027-04-03");

  assert.equal(coiDue("2027-03-01", 60, "2027-04-01T14:00:00.000Z").timeToAsk, false, "never after the day");
});

test("one automatic request per job, however often the sweep runs", () => {
  assert.deepEqual(coiRequestIds("p1"), coiRequestIds("p1"));
  assert.equal(coiRequestIds("p1").requestId, "coi_auto_p1");
});

test("a venue is remembered by its place, else by its name however it is typed", () => {
  assert.equal(venueKey({ name: "Lakeside Lodge" }), venueKey({ name: "  lakeside   LODGE!" }));
  assert.notEqual(venueKey({ placeId: "abc", name: "Lakeside Lodge" }), venueKey({ name: "Lakeside Lodge" }));
  assert.equal(venueKey({ placeId: "abc" }), venueKey({ placeId: "abc", name: "Something else" }));
  assert.equal(venueKey({}), null);
});

test("chasing: every few days, daily in the final week, then the studio is told", () => {
  const base = { now: NOW, dueDate: "2027-05-01", chaseCount: 0, chaseEveryDays: 3, maxChases: 4 };
  assert.equal(chaseDecision({ ...base, lastActivity: NOW - 2 * DAY }), "wait");
  assert.equal(chaseDecision({ ...base, lastActivity: NOW - 3 * DAY }), "chase");
  // Seven days to due: a day's silence is enough.
  assert.equal(chaseDecision({ ...base, dueDate: "2027-04-08", lastActivity: NOW - DAY }), "chase");
  // Five days out, or after the last chase, emailing again helps nobody.
  assert.equal(chaseDecision({ ...base, dueDate: "2027-04-06", lastActivity: NOW }), "escalate");
  assert.equal(chaseDecision({ ...base, chaseCount: 4, lastActivity: NOW - 10 * DAY }), "escalate");
});

const journey: JourneyInput = {
  projectId: "p1",
  state: "PLANNING",
  eventDate: "2027-09-18",
  today: "2027-08-01",
  lead: { id: "l1", status: "converted" },
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "signed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: null,
  questionnaireStatus: null,
  questionnaireHasAnswers: false,
  scheduleStatus: null,
  scheduleHasUsableItems: false,
  crewAccepted: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "required",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
};
const coiStep = (coiStatus: string | null) =>
  projectJourney({ ...journey, coiStatus }).steps.find((step) => step.key === "coi");

test("the COI step is done only once the venue has the certificate", () => {
  for (const status of ["approved", "under_review", "received", "requested", "prepared"]) {
    assert.notEqual(coiStep(status)?.status, "complete", `${status} is not done: the venue doesn't have it yet`);
  }
  assert.equal(coiStep("sent_to_venue")?.status, "complete");
  assert.equal(coiStep("venue_acknowledged")?.status, "complete");
});

test("the studio's COI moves read as the studio's, the agent's as waiting", () => {
  for (const status of ["prepared", "needs_details", "self_serve", "under_review", "approved", "failed"]) {
    assert.notEqual(coiStep(status)?.status, "waiting_other", `${status} is the studio's move`);
  }
});

const request = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  tenantId: "t1",
  projectId: `p-${id}`,
  status,
  venueName: "Lakeside Lodge",
  dueDate: "2027-09-04",
  updatedAt: "2027-08-01T00:00:00.000Z",
  ...extra,
});
const projects = (ids: string[]) =>
  ids.map((id) => ({ id: `p-${id}`, tenantId: "t1", name: `Job ${id}`, state: "PLANNING", eventDate: "2027-09-18" }));

test("Today: one card per certificate the studio has to act on", () => {
  const inbox = todayInbox({
    now: "2027-08-01T12:00:00.000Z",
    projects: projects(["a", "b", "c", "d", "e"]),
    insuranceRequests: [
      request("a", "prepared"),
      request("b", "under_review"),
      request("c", "requested"),
      request("d", "requested", { escalatedAt: "2027-08-01T00:00:00.000Z" }),
      request("e", "needs_details"),
    ],
    coiSettings: [{ id: "t1", tenantId: "t1", agentPhone: "617 555 0100" }],
  });
  const cards = [...inbox.act, ...inbox.approve, ...inbox.fyi].filter((item) => item.id.startsWith("coi-"));
  const ids = cards.map((card) => card.id).sort();
  assert.deepEqual(ids, ["coi-details-e", "coi-escalated-d", "coi-prepared-a", "coi-under_review-b"]);
  const escalated = cards.find((card) => card.id === "coi-escalated-d");
  assert.ok(JSON.stringify(escalated).includes("617 555 0100"), "the escalation card carries the agent's phone");
  assert.ok(!ids.includes("coi-setup"), "settings saved: no set-up nudge");
});

test("Today: a booked job needing a COI, and no one saved to send it, asks once", () => {
  const inbox = todayInbox({
    now: "2027-08-01T12:00:00.000Z",
    projects: projects(["a", "b"]).map((project) => ({ ...project, insuranceRequired: "required" })),
    insuranceRequests: [],
    coiSettings: [],
  });
  const setup = [...inbox.act, ...inbox.approve, ...inbox.fyi].filter((item) => item.id === "coi-setup");
  assert.equal(setup.length, 1);
  assert.equal(setup[0]?.action.kind === "link" ? setup[0].action.href : null, "/studio/settings/insurance");
});

const noExtraction: InquiryExtraction = {
  firstName: null,
  lastName: null,
  partnerName: null,
  email: null,
  phone: null,
  eventDate: null,
  venue: null,
  city: null,
  ceremonyTime: null,
  guestCount: null,
  budget: null,
  wantsPhotography: null,
  wantsVideography: null,
  referralSource: null,
  venueRequiresInsurance: null,
};

test("a message saying the venue needs a COI fills the answer, and never a no", () => {
  assert.equal(fillsFor({}, { ...noExtraction, venueRequiresInsurance: true }, "2027-01-01").coiRequired, "yes");
  assert.equal(fillsFor({}, { ...noExtraction, venueRequiresInsurance: false }, "2027-01-01").coiRequired, undefined);
  assert.equal(
    fillsFor({ coiRequired: "no" }, { ...noExtraction, venueRequiresInsurance: true }, "2027-01-01").coiRequired,
    undefined,
    "the couple's own answer stands",
  );
});

test("a corrected or re-sent certificate is reviewed, not stuck at received", () => {
  const scan = readFileSync("functions/src/operations/file-safety.ts", "utf8");
  // The review job is per PDF: a finished one for another file is re-queued.
  assert.match(scan, /existing\.get\("object"\) === input\.object/);
  assert.match(scan, /temporaryObject: input\.object/);
  const attach = readFileSync("functions/src/coi/actions.ts", "utf8");
  // A scan that beat the attach call is never rolled back to "received".
  assert.match(attach, /const waiting = \["self_serve", "requested", "correction_required"\]/);
});

test("a certificate with the agent reads as the agent's, not the crew's", () => {
  const plan = readFileSync("components/projects/project-job-plan.tsx", "utf8");
  assert.match(plan, /if \(step\.key === "coi"\) return "Agent";/);
});

test("the agent gets everything the certificate needs, not just the holder's name", async () => {
  const { renderEmailTemplate } = await import("../functions/src/communications/email-templates");
  const rendered = renderEmailTemplate({
    key: "coi_request",
    brand: { studioName: "FlawlessIQ", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    values: {
      requirement: {
        certificateHolder: "President and Fellows of Harvard College",
        venueLegalName: "Arnold Arboretum",
        venueAddress: "125 Arborway, Boston, MA 02130",
        eventDate: "2027-06-12",
        dueDate: "2027-05-29",
        coverageTypes: ["General liability"],
        requiredLimits: { generalLiability: 100_000_000 },
        additionalInsuredWording: "Arnold Arboretum and its officers",
        waiverOfSubrogation: true,
        primaryNoncontributory: false,
        specialInstructions: "Policy HX-12345.",
      },
    },
  });
  assert.match(rendered.text, /Holder address: 125 Arborway, Boston, MA 02130\./);
  assert.match(rendered.text, /Coverage: General liability — general liability \$1,000,000\./);
  assert.match(rendered.text, /Additional insured, worded exactly: "Arnold Arboretum and its officers"/);
  assert.match(rendered.text, /waiver of subrogation/);
  assert.doesNotMatch(rendered.text, /noncontributory/);
  assert.match(rendered.text, /Policy HX-12345\./);
});

test("the agent's correction and the venue's copy never greet the couple, and name the event", async () => {
  const { renderEmailTemplate } = await import("../functions/src/communications/email-templates");
  const brand = { studioName: "FlawlessIQ", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const correction = renderEmailTemplate({
    key: "coi_correction",
    brand,
    recipientName: "Harper Lane",
    values: {
      reason: "State the each-occurrence limit.",
      requirement: { venueLegalName: "Arnold Arboretum", eventDate: "2027-06-12" },
    },
  });
  assert.doesNotMatch(correction.text, /Harper/);
  assert.match(correction.text, /certificate you sent for Arnold Arboretum on June 12, 2027/);
  const venue = renderEmailTemplate({
    key: "coi_venue_delivery",
    brand,
    recipientName: "Harper Lane",
    values: { venueName: "Arnold Arboretum", eventDate: "2027-06-12" },
  });
  assert.doesNotMatch(venue.text, /Harper/);
  assert.match(venue.text, /for Arnold Arboretum, for the event on June 12, 2027\./);
});

test("a certificate decision refreshes the list above the card", () => {
  const source = readFileSync("components/planning/coi-request-actions.tsx", "utf8");
  assert.match(source, /if \(outcome\.persisted\) refreshTenantRecords\("insuranceRequests"/);
});

test("both paths that send a certificate to the venue carry the event date", () => {
  const commands = readFileSync("functions/src/planning/commands.ts", "utf8");
  const actions = readFileSync("functions/src/coi/actions.ts", "utf8");
  for (const source of [commands, actions]) {
    const at = source.indexOf('type: "coi_venue_delivery"');
    assert.ok(at > 0);
    assert.match(source.slice(at, at + 600), /eventDate: requirement\.get\("eventDate"\) \?\? null/);
  }
});
