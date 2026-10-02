import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bookingGateNeeds,
  clientRef,
  hasFinalBalance,
  JOB_KIND_LABELS,
  JOB_KINDS,
  jobKindFromLabel,
  jobKindOf,
  journeyProfile,
  vocab,
} from "@/features/job-kinds/job-kinds";
import { templateKeyForKind } from "../functions/src/job-kinds/template-key.ts";

/**
 * Kinds of job (docs/job-types-plan-2026-10-02.md). A studio's family
 * sessions, corporate events and sports days run through the same journey as
 * its weddings; the kind decides the words, the steps, the timings and the
 * starter content. These pin the decisions GR Productions made on 2026-10-02.
 */

const MARKER = "// ── mirrored below ──";
const below = (path: string) => {
  const source = readFileSync(path, "utf8");
  return source.slice(source.indexOf(MARKER));
};

test("the functions copy of the kinds has not drifted", () => {
  assert.equal(
    below("functions/src/job-kinds/job-kinds.ts"),
    below("features/job-kinds/job-kinds.ts"),
    "functions/ decides a job's kind differently from the app",
  );
});

test("a job's kind: stored first, then its type id, then its label — never wedding by default", () => {
  assert.equal(jobKindOf({ eventKind: "sports", eventTypeId: "wedding" }), "sports");
  assert.equal(jobKindOf({ eventKind: "general" }), "other");
  assert.equal(jobKindOf({ eventTypeId: "corporate" }), "corporate");
  assert.equal(jobKindOf({ eventTypeId: "wedding" }), "wedding");
  // The retired eventTypeTemplates ids.
  assert.equal(jobKindOf({ eventTypeId: "school" }), "portraits");
  assert.equal(jobKindOf({ eventTypeId: "business" }), "corporate");
  // A studio's own labels.
  assert.equal(jobKindOf({ eventTypeId: "x", eventType: "Mini sessions" }), "portraits");
  assert.equal(jobKindOf({ eventType: "Cheer" }), "sports");
  assert.equal(jobKindOf({ eventType: "Headshots" }), "corporate");
  assert.equal(jobKindOf({ eventType: "Elopement" }), "wedding");
  // Unknown is "other": a family reading "your wedding" is the failure.
  assert.equal(jobKindOf({ eventType: "Bar mitzvah" }), "other");
  assert.equal(jobKindOf({}), "other");
  assert.equal(jobKindOf(null), "other");
  assert.equal(jobKindFromLabel(""), null);
});

test("Gabe's answers: family books on payment alone, sports on its date", () => {
  const family = journeyProfile("portraits");
  assert.equal(family.agreement, false);
  assert.equal(family.payment, "paid_in_full");
  assert.deepEqual(bookingGateNeeds(family), { agreement: false, payment: true });
  assert.equal(hasFinalBalance(family), false);
  assert.equal(family.finalDetailsLock, false);
  assert.equal(family.exclusiveDay, false);

  const sports = journeyProfile("sports");
  assert.equal(sports.agreement, false);
  assert.equal(sports.payment, "on_the_day");
  assert.deepEqual(bookingGateNeeds(sports), { agreement: false, payment: false });
  assert.equal(hasFinalBalance(sports), false);

  const wedding = journeyProfile("wedding");
  assert.deepEqual(bookingGateNeeds(wedding), { agreement: true, payment: true });
  assert.equal(hasFinalBalance(wedding), true);
  assert.equal(wedding.finalDetailsLock, true);
  assert.equal(wedding.exclusiveDay, true);
});

test("corporate is paid either way: the package decides", () => {
  assert.equal(journeyProfile("corporate").payment, "deposit_and_balance");
  const after = journeyProfile("corporate", { payment: "invoice_after" });
  assert.equal(after.payment, "invoice_after");
  assert.equal(after.agreement, true);
  assert.deepEqual(bookingGateNeeds(after), { agreement: true, payment: false });
  // Nonsense leaves the kind's default.
  assert.equal(journeyProfile("corporate", { payment: "barter" }).payment, "deposit_and_balance");
});

test("a wedding's details form follows the studio's planning timeline", () => {
  assert.equal(journeyProfile("wedding").detailsFormDaysBefore, 180);
  assert.equal(journeyProfile("wedding", { detailsFormDaysBefore: 120 }).detailsFormDaysBefore, 120);
  assert.equal(journeyProfile("portraits").detailsFormDaysBefore, 14);
});

test("every kind has every word, and a family is never 'the couple'", () => {
  for (const kind of JOB_KINDS) {
    const words = vocab(kind);
    for (const [key, value] of Object.entries(words)) {
      if (Array.isArray(value)) assert.ok(value.length > 0, `${kind}.${key}`);
      else assert.ok(String(value).trim().length > 0, `${kind}.${key}`);
    }
    assert.ok(JOB_KIND_LABELS[kind]);
    if (kind !== "wedding") {
      const text = JSON.stringify(words).toLowerCase();
      for (const word of ["wedding", "couple", "bride", "groom", "ceremony", "dress"]) {
        assert.ok(!text.includes(word), `${kind} says "${word}"`);
      }
    }
  }
  assert.equal(clientRef("Emma & James", "portraits"), "Emma & James");
  assert.equal(clientRef("", "portraits"), "the family");
  assert.equal(clientRef(null, "wedding"), "the couple");
});

test("a job's template key: the kind, or a wedding studio's own wedding id", () => {
  assert.equal(templateKeyForKind("portraits", "wedding"), "portraits");
  assert.equal(templateKeyForKind("sports", "cheer"), "sports");
  assert.equal(templateKeyForKind("wedding", "wedding"), "wedding");
  assert.equal(templateKeyForKind("wedding", "weddings"), "weddings");
  // A lowercased label is not a template key.
  assert.equal(templateKeyForKind("wedding", "elopement"), "wedding");
  assert.equal(templateKeyForKind("wedding", ""), "wedding");
});

test("every path that makes a job writes its kind", () => {
  const sources: Array<[string, RegExp]> = [
    ["functions/src/intake/convert.ts", /eventKind: jobKindOf\(/],
    ["functions/src/intake/capture.ts", /eventKind: capturedKind/],
    ["functions/src/crm/commands.ts", /eventKind,\s*\n\s*eventTypeKey: command\.input\.eventTypeKey/],
    ["functions/src/imports/commands.ts", /eventKind,/],
  ];
  for (const [path, pattern] of sources) {
    assert.match(readFileSync(path, "utf8"), pattern, path);
  }
});

// ── Phase 2: steps, timings and the light path ────────────────────────────

import { bookingGateRequirements } from "@/features/booking/gate-requirements";
import { bookedOnceClause, dateClashes, detailsFormOpensOn, projectGateNeeds } from "@/features/job-kinds/job-kinds";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";
import { mayRaiseFinalBill } from "../functions/src/operations/invoice-scheduler.ts";
import { singleBillDueDate, singleBillWindow } from "@/features/job-kinds/job-kinds";
import { bookingGateRequirements as functionsGate } from "../functions/src/booking/gate-requirements.ts";

const nothingYet = {
  contractCompleted: false,
  contractAttestedManually: false,
  retainerInvoiceCreated: false,
  retainerAttestedManually: false,
  retainerSatisfied: false,
  retainerExceptionApproved: false,
  eventDateAvailable: true,
  requiredContactsComplete: true,
};

test("the gate asks each kind only for what it needs", () => {
  const unmet = (requirements: Record<string, boolean>) =>
    Object.entries(requirements).filter(([, passed]) => !passed).map(([key]) => key).sort();
  // A wedding needs both.
  assert.deepEqual(unmet(bookingGateRequirements(nothingYet, projectGateNeeds({ eventKind: "wedding" }))), [
    "contractCompleted",
    "retainerInvoiceCreated",
    "retainerSatisfied",
  ]);
  // A family session books on payment alone.
  assert.deepEqual(unmet(bookingGateRequirements(nothingYet, projectGateNeeds({ eventKind: "portraits" }))), [
    "retainerInvoiceCreated",
    "retainerSatisfied",
  ]);
  // A sports day books on its date and contact.
  assert.deepEqual(unmet(bookingGateRequirements(nothingYet, projectGateNeeds({ eventKind: "sports" }))), []);
  // Contacts still matter for every kind.
  assert.deepEqual(
    unmet(bookingGateRequirements({ ...nothingYet, requiredContactsComplete: false }, projectGateNeeds({ eventKind: "sports" }))),
    ["requiredContactsComplete"],
  );
  // The functions copy folds the same way.
  for (const kind of ["wedding", "portraits", "sports", "corporate"] as const) {
    assert.deepEqual(
      functionsGate(nothingYet, projectGateNeeds({ eventKind: kind })),
      bookingGateRequirements(nothingYet, projectGateNeeds({ eventKind: kind })),
      kind,
    );
  }
  // Omitted needs: the wedding gate, unchanged.
  assert.deepEqual(bookingGateRequirements(nothingYet), bookingGateRequirements(nothingYet, projectGateNeeds({ eventKind: "wedding" })));
});

test("a wedding takes the whole day; sessions share one", () => {
  const wedding = { eventKind: "wedding" };
  const session = { eventKind: "portraits" };
  assert.equal(dateClashes(session, [session, session]), false);
  assert.equal(dateClashes(session, [wedding]), true);
  assert.equal(dateClashes(wedding, [session]), true);
  assert.equal(dateClashes(wedding, []), false);
  assert.equal(dateClashes({ eventKind: "sports" }, [{ eventKind: "sports" }]), false);
});

test("the one bill for a job that booked with nothing paid", () => {
  const today = "2026-10-02";
  const sports = { eventKind: "sports", state: "BOOKED", eventDate: "2026-10-10" };
  assert.deepEqual(singleBillWindow(sports, today), { dueDate: "2026-10-10" });
  assert.equal(singleBillWindow({ ...sports, eventDate: "2026-11-20" }, today), null, "not yet");
  assert.deepEqual(singleBillWindow({ ...sports, state: "EVENT_COMPLETE", eventDate: "2026-09-30" }, today), { dueDate: "2026-09-30" }, "still unpaid after the day");
  const after = { eventKind: "corporate", paymentShape: "invoice_after", state: "EVENT_COMPLETE", eventDate: "2026-09-28" };
  assert.deepEqual(singleBillWindow(after, today), { dueDate: "2026-10-28" });
  assert.equal(singleBillWindow({ ...after, state: "BOOKED", eventDate: "2026-10-28" }, today), null, "not shot yet");
  assert.equal(singleBillDueDate({ ...after, eventDate: "2026-12-31" }), "2027-01-30");
  // Deposit and paid-in-full jobs are not billed this way.
  assert.equal(singleBillWindow({ eventKind: "wedding", state: "BOOKED", eventDate: "2026-10-10" }, today), null);
  assert.equal(singleBillWindow({ eventKind: "portraits", state: "BOOKED", eventDate: "2026-10-10" }, today), null);
  // The balance run leaves alone every job without a deposit…
  assert.equal(mayRaiseFinalBill({ eventKind: "portraits", state: "BOOKED", eventDate: "2026-10-10" }, today, "2026-10-30"), false);
  assert.equal(mayRaiseFinalBill(sports, today, "2026-10-30"), false);
  assert.equal(mayRaiseFinalBill({ eventKind: "wedding", state: "BOOKED", eventDate: "2026-10-10" }, today, "2026-10-30"), true);
  // …and never creates a customer: the studio sends the one bill from Today.
  const send = readFileSync("functions/src/booking/send-final-balance.ts", "utf8");
  assert.match(send, /dueDate: singleBillDueDate\(project\.data\(\)\) \?\? undefined/);
  const inbox = readFileSync("features/today/inbox.ts", "utf8");
  assert.match(inbox, /singleBillWindow\(job, input\.now\.slice\(0, 10\)\)/);
});

test("a session's details form goes two weeks out; a wedding's follows the studio", () => {
  assert.equal(detailsFormOpensOn({ eventKind: "portraits" }, "2026-11-20", "2026-05-20"), "2026-11-06");
  assert.equal(detailsFormOpensOn({ eventKind: "wedding" }, "2026-11-20", "2026-05-20"), "2026-05-20");
  assert.equal(detailsFormOpensOn({ eventKind: "corporate" }, "2026-11-20", null), "2026-10-23");
  assert.equal(detailsFormOpensOn({ eventKind: "portraits" }, null, null), null);
});

const journeyBase: JourneyInput = {
  projectId: "p1",
  state: "PROPOSAL",
  eventDate: "2026-12-01",
  today: "2026-10-02",
  lead: null,
  hasConsultation: false,
  proposalStatus: "sent",
  contractStatus: null,
  retainerInvoiceStatus: null,
  finalInvoiceStatus: null,
  questionnaireStatus: null,
  questionnaireHasAnswers: false,
  scheduleStatus: null,
  scheduleHasUsableItems: false,
  crewAccepted: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: null,
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
};

test("a sports job's journey has no contract, retainer or balance to chase", () => {
  const keys = (profileKind: string) =>
    projectJourney({ ...journeyBase, profile: projectProfileFor(profileKind) }).steps.map((step) => step.key);
  const wedding = keys("wedding");
  for (const key of ["contract", "retainer", "final_balance", "consultation"]) assert.ok(wedding.includes(key as never), key);
  const sports = keys("sports");
  for (const key of ["contract", "retainer", "consultation"]) assert.ok(!sports.includes(key as never), key);
  const final = projectJourney({ ...journeyBase, profile: projectProfileFor("sports") }).steps.find((step) => step.key === "final_balance");
  assert.equal(final?.title, "Paid on the day");
  const family = projectJourney({ ...journeyBase, profile: projectProfileFor("portraits") }).steps;
  assert.ok(!family.some((step) => step.key === "contract"));
  assert.ok(!family.some((step) => step.key === "final_balance"));
  assert.equal(family.find((step) => step.key === "retainer")?.title, "Paid in full");
  // Without a profile, every step applies — the wedding journey, unchanged.
  assert.deepEqual(
    projectJourney(journeyBase).steps.map((step) => step.key),
    projectJourney({ ...journeyBase, profile: projectProfileFor("wedding") }).steps.map((step) => step.key),
  );
});

function projectProfileFor(kind: string) {
  return journeyProfile(kind as never);
}

test("the client's steps to reserve a date follow the kind", async () => {
  const { bookingSteps } = await import("../features/client/booking-steps.ts");
  const keys = (view: { steps: Array<{ key: string }> }) => view.steps.map((step) => step.key);
  const wedding = bookingSteps({ proposalStatus: "sent", contractStatus: null, retainer: null });
  assert.deepEqual(keys(wedding), ["proposal", "agreement", "deposit", "booked"]);
  assert.match(wedding.next.detail, /three short steps/);
  const family = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: null,
    retainer: { status: "open", balanceCents: 30000, hostedUrl: "https://pay.example", atProvider: true },
    needs: { agreement: false, payment: true, paidInFull: true },
  });
  assert.deepEqual(keys(family), ["proposal", "deposit", "booked"]);
  assert.equal(family.next.title, "Make your payment");
  assert.equal(family.steps.find((step) => step.key === "deposit")?.label, "Make your payment");
  assert.doesNotMatch(JSON.stringify(family), /agreement|deposit invoice/i);
  const sports = bookingSteps({ proposalStatus: "accepted", contractStatus: null, retainer: null, needs: { agreement: false, payment: false } });
  assert.deepEqual(keys(sports), ["proposal", "booked"]);
  assert.equal(sports.booked, true);
});

test("Cue and the Booking tab say what this kind needs to book", () => {
  assert.equal(bookedOnceClause(journeyProfile("wedding")), "the agreement is signed and the retainer is paid");
  assert.equal(bookedOnceClause(journeyProfile("portraits")), "it's paid in full");
  assert.equal(bookedOnceClause(journeyProfile("sports")), "the date and client details check out");
  assert.equal(bookedOnceClause(journeyProfile("corporate", { payment: "invoice_after" })), "the agreement is signed");
});
