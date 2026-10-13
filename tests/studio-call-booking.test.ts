import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { finalCallState } from "@/features/consultations/final-call";
import { bookCallHref, bookableCalls, callForJob } from "@/features/consultations/studio-booking";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";

/**
 * Conor, 2026-10-13: the final details call step opened the calendar, and the
 * calendar booked a "consultation" for a wedding booked months ago, which
 * never ticked the step. Each call step now opens the calendar on its own
 * call, and the booking carries it.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const journeyBase = {
  projectId: "p1",
  state: "BOOKED",
  eventDate: "2026-11-14",
  today: "2026-10-13",
  lead: { id: "l", status: "converted", replied: true },
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: null,
  questionnaireStatus: "submitted",
  questionnaireHasAnswers: true,
  scheduleStatus: null,
  scheduleApprovalState: "none",
  scheduleHasUsableItems: false,
  crewAccepted: 0,
  crewRequired: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "not_required",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
} as JourneyInput;

test("each trade books its own calls, in its own words", () => {
  assert.deepEqual(bookableCalls("photographer").map((call) => [call.purpose, call.label]), [
    ["consultation", "Consultation"],
    ["final_details", "Final details call"],
  ]);
  assert.deepEqual(bookableCalls("dj").map((call) => call.label), ["Vibe call", "Final planning call"]);
  assert.ok(bookableCalls("makeup").some((call) => call.purpose === "trial"));
  assert.ok(!bookableCalls("makeup").some((call) => call.purpose === "consultation"), "makeup has no sales call");
});

test("the call: the link's, else a booked job is past its consultation", () => {
  assert.equal(callForJob({ param: "final_details", projectState: "LEAD", trade: "photographer" }).purpose, "final_details");
  assert.equal(callForJob({ param: null, projectState: "LEAD", trade: "photographer" }).purpose, "consultation");
  assert.equal(callForJob({ param: null, projectState: "BOOKED", trade: "photographer" }).purpose, "final_details", "Smith Wedding, booked");
  assert.equal(callForJob({ param: null, projectState: "BOOKED", trade: "makeup" }).purpose, "trial");
  assert.equal(callForJob({ param: "nonsense", projectState: "PLANNING", trade: "photographer" }).purpose, "final_details");
  assert.equal(bookCallHref("p1", "final_details"), "/studio/calendar?project=p1&call=final_details");
});

test("the journey's final call step books that call, until it's booked", () => {
  const step = (state: NonNullable<JourneyInput["finalCall"]>["state"]) =>
    projectJourney({ ...journeyBase, finalCall: { state, lockOn: "2026-10-17", startsAt: state === "booked" ? "2026-10-20T15:00:00Z" : null } }).steps.find((candidate) => candidate.key === "final_call")!;
  assert.deepEqual(step("invited").action, { kind: "link", label: "Book the final details call", href: "/studio/calendar?project=p1&call=final_details" });
  // Upcoming steps never offer an action; their link still opens on the call.
  assert.equal(step("due").action, null);
  assert.equal(step("due").record?.href, "/studio/calendar?project=p1&call=final_details");
  assert.equal(step("booked").action, null);
  assert.equal(step("paused").action, null, "not while emails to them are paused");
  assert.equal(step("invited").record?.href, "/studio/calendar?project=p1&call=final_details", "Open calendar opens on the call");
  assert.equal(step("not_sent").record?.href, "/studio/calendar?project=p1&call=final_details");
});

test("a final details call booked by the studio ticks the step", () => {
  const state = finalCallState({
    project: { id: "p1", state: "BOOKED", eventDate: "2026-11-14", eventKind: "wedding" },
    planningTimeline: null,
    consultations: [{ id: "c1", purpose: "final_details", status: "scheduled", startsAt: "2026-10-20T15:00:00Z" }],
    today: "2026-10-13",
    now: "2026-10-13T12:00:00Z",
  });
  assert.equal(state?.state, "booked");
});

test("wired: the booking carries its call; only the sales call moves the job or waits on the form", () => {
  const commands = read("functions/src/booking/commands.ts");
  assert.match(commands, /purpose: z\.enum\(\["consultation", "final_details", "trial", "walkthrough"\]\)\.optional\(\),/);
  assert.match(commands, /const purpose = command\.input\.purpose \?\? "consultation";\s*const salesCall = purpose === "consultation";/);
  assert.match(commands, /if \(salesCall\) await firestore\.runTransaction\(/);
  assert.match(commands, /if \(salesCall\) await queueInquiryFormAnalysis\(/);
  assert.match(commands, /link\.get\("status"\) === "pending" && consultationPurpose\(link\.data\(\)\) === purpose/, "the couple's own link stops offering times");
  const calendar = read("components/booking/studio-calendar.tsx");
  assert.match(calendar, /setCallParam\(search\.get\("call"\)\);/);
  assert.match(calendar, /purpose: call\.purpose,/);
});
