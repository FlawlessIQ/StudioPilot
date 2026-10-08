import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { finalCallState } from "@/features/consultations/final-call";
import { isSalesConsultation, isFinalDetailsCall } from "@/features/consultations/purpose";
import { currentSalesConsultation } from "@/features/consultations/live";
import { projectJourney } from "@/features/journey/steps";
import { resolvePlanningTimeline } from "@/features/planning/planning-timeline";
import { mintBookingLink } from "../functions/src/booking/booking-link.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

/**
 * Gabe, Chuck and Albert (GR, 2026-10-08): "After the schedule is set 1 month
 * out a zoom/phone call should be part of the journey to close out the job
 * readiness. The client and studio will go over any final details and make
 * changes to the final schedule."
 */

const read = (path: string) => readFileSync(path, "utf8");
const wedding = { tenantId: "t", eventDate: "2027-06-12", eventKind: "wedding", state: "PLANNING" };
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("one call or the other, and every record from before is the sales consultation", () => {
  assert.equal(isSalesConsultation({}), true);
  assert.equal(isSalesConsultation({ purpose: "final_details" }), false);
  assert.equal(isFinalDetailsCall({ purpose: "final_details" }), true);
  const sales = { id: "s", status: "completed", startsAt: "2026-03-01T15:00:00Z" };
  const final = { id: "f", status: "scheduled", startsAt: "2027-05-20T15:00:00Z", purpose: "final_details" };
  assert.equal(currentSalesConsultation([sales, final])?.id, "s", "Log a call and the brief never pick the final call");
  assert.equal(
    read("functions/src/booking/consultation-purpose.ts").replace(/\(and back\)/, ""),
    read("features/consultations/purpose.ts").replace(/\(and back\)/, ""),
  );
});

test("on by default; invited at the lock; booked; held", () => {
  assert.equal(resolvePlanningTimeline({}).finalCall, true);
  const state = (consultations: Record<string, unknown>[], today: string, timeline: unknown = {}) =>
    finalCallState({ project: wedding, planningTimeline: timeline, consultations, today, now: `${today}T15:00:00Z` });
  assert.deepEqual(state([], "2027-04-01"), { state: "not_yet", lockOn: "2027-05-15", startsAt: null });
  assert.equal(state([], "2027-05-15")?.state, "invited");
  const call = { purpose: "final_details", status: "scheduled", startsAt: "2027-05-20T19:00:00Z" };
  assert.equal(state([call], "2027-05-16")?.state, "booked");
  assert.equal(state([call], "2027-05-21")?.state, "held");
  // The sales consultation never counts as the final call.
  assert.equal(state([{ status: "completed", startsAt: "2026-03-01T15:00:00Z" }], "2027-05-16")?.state, "invited");
  assert.equal(state([], "2027-05-16", { finalCall: false }), null, "the studio turned it off");
  assert.equal(
    finalCallState({ project: { ...wedding, eventKind: "family" }, planningTimeline: {}, consultations: [], today: "2027-05-16", now: "x" }),
    null,
    "a family session has no lock and no call",
  );
});

test("the journey shows it in Preparation, waiting on the couple once invited", () => {
  const journey = (finalCall: Parameters<typeof projectJourney>[0]["finalCall"]) =>
    projectJourney({
      projectId: "p",
      state: "PLANNING",
      eventDate: "2027-06-12",
      today: "2027-05-16",
      lead: null,
      hasConsultation: true,
      proposalStatus: "accepted",
      contractStatus: "completed",
      retainerInvoiceStatus: "paid",
      finalInvoiceStatus: null,
      questionnaireStatus: "submitted",
      questionnaireHasAnswers: true,
      scheduleStatus: "published",
      scheduleHasUsableItems: true,
      crewAccepted: 1,
      coiRequired: false,
      coiStatus: null,
      deliveryStatus: null,
      reviewStatus: null,
      finalCall,
    } as Parameters<typeof projectJourney>[0]).steps.find((step) => step.key === "final_call");
  assert.equal(journey(null), undefined, "no call, no step");
  const invited = journey({ state: "invited", lockOn: "2027-05-15", startsAt: null })!;
  assert.equal(invited.status, "waiting_client");
  assert.match(invited.detail, /waiting for .* to pick a time/);
  const booked = journey({ state: "booked", lockOn: "2027-05-15", startsAt: "2027-05-20T19:00:00Z" })!;
  assert.equal(booked.status, "complete");
  assert.match(booked.detail, /^Booked for /);
  const notYet = journey({ state: "not_yet", lockOn: "2027-05-15", startsAt: null })!;
  assert.equal(notYet.status, "upcoming");
  assert.match(String(notYet.unlock), /May 15/);
});

test("its link is its own: it never overwrites the couple's consultation link", () => {
  const base = { tenantId: "t", projectId: "p", contactId: "c", email: "a@b.com", mode: "zoom" as const, actorId: "x", now: "2027-05-15T16:00:00.000Z", days: 25 };
  const sales = mintBookingLink({ ...base, purpose: "consultation" });
  const final = mintBookingLink({ ...base, purpose: "final_details" });
  assert.notEqual(sales.linkId, final.linkId);
  assert.match(final.linkId, /^final_/);
  assert.equal(final.record.purpose, "final_details");
});

test("the emails say final details call, and the lock's email carries the booking button", () => {
  const values = { purpose: "final_details", startsAt: "2027-05-20T19:00:00.000Z", timezone: "America/New_York" };
  const confirmed = renderEmailTemplate({ key: "consultation_confirmation", brand, recipientName: "Avery Stone", projectName: "Avery & Sam", values });
  assert.equal(confirmed.subject, "Final details call with GR Productions");
  assert.doesNotMatch(confirmed.text, /consultation/i);
  const invite = renderEmailTemplate({ key: "consultation_invitation", brand, recipientName: "Avery Stone", projectName: "Avery & Sam", values: { purpose: "final_details", actionUrl: "https://studio-cue.com/schedule/consultation?token=x" } });
  assert.equal(invite.subject, "Book your final details call with GR Productions");
  const lock = renderEmailTemplate({
    key: "final_details_request",
    brand,
    recipientName: "Avery Stone",
    projectName: "Avery & Sam",
    values: { portalUrl: "https://studio-cue.com/client?final-details=1", finalCallUrl: "https://studio-cue.com/schedule/consultation?token=y" },
  });
  assert.match(lock.html, /Book your final details call/);
  assert.match(lock.text, /short call to go over everything together/);
  // The sales consultation's emails are unchanged.
  assert.equal(
    renderEmailTemplate({ key: "consultation_confirmation", brand, recipientName: "Avery Stone", projectName: "Avery & Sam", values: { startsAt: values.startsAt, timezone: values.timezone } }).subject,
    "Consultation with GR Productions",
  );
});

test("nothing that means 'the sales consultation' picks up the final call", () => {
  assert.match(read("functions/src/planning/final-details.ts"), /purpose: FINAL_DETAILS_PURPOSE/);
  assert.match(read("functions/src/planning/final-details.ts"), /finalCallUrl: call\?\.bookingUrl \?\? null/);
  assert.match(read("functions/src/booking/consultation-prep.ts"), /if \(isFinalDetailsCall\(data\)\) return "skipped";/);
  assert.equal((read("functions/src/booking/commands.ts").match(/FINAL_DETAILS_CALL_NOT_A_CONSULTATION/g) ?? []).length, 2, "complete and rerun brief");
  assert.match(read("functions/src/booking/public-scheduling.ts"), /if \(!finalCall && project\.get\("state"\) === "LEAD"\)/);
  assert.match(read("functions/src/booking/public-scheduling.ts"), /filter\(\(document\) => !isFinalDetailsCall\(document\.data\(\)\)\)/);
  assert.match(read("functions/src/intake/inquiry-form.ts"), /document\.get\("purpose"\) !== "final_details"/);
  assert.match(read("functions/src/ai/copilot.ts"), /\.filter\(\(record\) => record\.purpose !== "final_details"\)/);
  assert.match(read("functions/src/automation/runtime.ts"), /purpose === "final_details"\) return null;/);
  assert.match(read("functions/src/booking/zoom-webhook.ts"), /consultation\.get\("purpose"\) !== "final_details"/);
  assert.match(read("components/projects/use-project-thread.ts"), /isSalesConsultation\(item\) && text\(item\.status\) === "scheduled"/);
  assert.match(read("components/projects/use-project-journey.ts"), /isSalesConsultation\(record\) && isLiveConsultation\(record\)/);
  assert.match(read("components/today/use-today-inbox.ts"), /isSalesConsultation\(record\) && isLiveConsultation\(record\)/);
  assert.match(read("components/reporting/live-reports.tsx"), /filter\(\(record\) => isSalesConsultation\(record\)\)/);
});
