import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { depositByStudio, paymentsConnected } from "../features/booking/deposit-by-studio";
import { journeyProfile } from "../features/job-kinds/job-kinds";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { todayInbox } from "../features/today/inbox";

/**
 * A booking link out with nothing to take the deposit (Riley Park, Spin
 * Theory DJs, 2026-10-09). No QuickBooks or Stripe, so the signature raises
 * no invoice: Today nudges the studio to connect payments before the client
 * signs, connecting then raises it after all, and once signed the job's own
 * step is "Record the deposit" — never "Create retainer invoice" through an
 * app nobody connected.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const plan = (currentStep: string, raises = false) => ({
  id: "job1",
  tenantId: "t",
  projectId: "job1",
  contractId: "contract1",
  status: "active",
  currentStep,
  policy: { createRetainerAfterSignature: raises, completeBookingAfterPayment: true, retainerDueDays: 7 },
  updatedAt: "2026-10-09T18:13:45.041Z",
});

test("the plan says whether the studio takes the deposit itself", () => {
  assert.equal(depositByStudio(plan("wait_for_signature")), true);
  assert.equal(depositByStudio(plan("wait_for_signature", true)), false);
  assert.equal(depositByStudio({ ...plan("wait_for_payment"), status: "completed" }), false);
  assert.equal(depositByStudio(null), false);
  assert.equal(paymentsConnected([{ provider: "quickbooks", status: "connected", archivedAt: null }]), true);
  assert.equal(paymentsConnected([{ provider: "stripe", status: "error", archivedAt: null }]), false);
  assert.equal(paymentsConnected([{ provider: "google_calendar", status: "connected", archivedAt: null }]), false);
  assert.equal(paymentsConnected([{ provider: "quickbooks", status: "connected", archivedAt: "2026-10-01" }]), false);
  assert.equal(paymentsConnected(null), false);
});

const signed = (trade: string, depositByStudio?: boolean): JourneyInput => ({
  projectId: "job1",
  state: "RETAINER_PENDING",
  eventDate: "2027-09-18",
  today: "2026-10-09",
  lead: null,
  hasConsultation: false,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: null,
  depositByStudio,
  finalInvoiceStatus: null,
  questionnaireStatus: null,
  questionnaireHasAnswers: false,
  scheduleStatus: null,
  scheduleHasUsableItems: false,
  crewAccepted: 0,
  crewRequired: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "unknown",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
  profile: journeyProfile("wedding"),
  trade,
});

test("signed with nothing connected, the job's step is to record the deposit", () => {
  const dj = projectJourney(signed("dj", true)).current;
  assert.equal(dj?.title, "Booked");
  assert.equal(dj?.detail, "Signed — they pay you directly. Record the deposit when it arrives");
  assert.deepEqual(dj?.action, { kind: "link", label: "Record the deposit", href: "/studio/booking?project=job1" });
  // A photographer records a retainer, in the same place.
  const photo = projectJourney(signed("photographer", true)).steps.find((step) => step.key === "retainer");
  assert.equal(photo?.action?.kind === "link" ? photo.action.label : null, "Record the retainer");
  // With an invoicing app (or an older job with no plan), as before.
  const before = projectJourney(signed("photographer")).steps.find((step) => step.key === "retainer");
  assert.equal(before?.detail, "Computed from your retainer rule");
  assert.deepEqual(before?.action, { kind: "link", label: "Create retainer invoice", href: "/studio/contracts?project=job1" });
  // An invoice raised by hand is with the client: not recorded twice.
  const raised = projectJourney({ ...signed("dj", true), retainerInvoiceStatus: "sent" }).steps.find((step) => step.title === "Booked");
  assert.equal(raised?.detail, "Invoice with the client");
  assert.equal(raised?.status, "waiting_client");
});

const today = (overrides: Record<string, unknown>) =>
  todayInbox({
    now: "2026-10-09T19:00:00.000Z",
    tenantTrade: "dj",
    projects: [{ id: "job1", tenantId: "t", name: "Riley Park Wedding", state: "PROPOSAL", eventDate: "2027-09-18", eventKind: "wedding" }],
    bookingOrchestrations: [plan("wait_for_signature")],
    integrationConnections: [],
    ...overrides,
  } as never);

test("Today: a link out with nothing to take the deposit says connect payments, once", () => {
  const card = today({}).act.find((item) => item.id === "connect-payments");
  assert.equal(card?.title, "Connect payments so Riley Park can pay the deposit online");
  assert.equal(
    card?.detail,
    "No QuickBooks or Stripe is connected, so after signing they'll be asked to arrange the deposit with you. Connect one before they sign and they pay it on the spot.",
  );
  assert.deepEqual(card?.action, { kind: "link", label: "Connect payments", href: "/studio/integrations" });
  assert.equal(card?.jobHref, "/studio/projects/job1");

  // Two links out: one card naming both, not two cards.
  const two = today({
    projects: [
      { id: "job1", tenantId: "t", name: "Riley Park Wedding", state: "PROPOSAL", eventDate: "2027-09-18", eventKind: "wedding" },
      { id: "job2", tenantId: "t", name: "Sam Lee Wedding", state: "PROPOSAL", eventDate: "2027-05-01", eventKind: "wedding" },
    ],
    bookingOrchestrations: [plan("wait_for_signature"), { ...plan("wait_for_signature"), id: "job2", projectId: "job2" }],
  }).act.filter((item) => item.id === "connect-payments");
  assert.equal(two.length, 1);
  assert.equal(two[0]?.title, "Connect payments so Sam Lee and Riley Park can pay the deposit online");
  assert.equal(two[0]?.jobHref, null);

  // Connected, signed, or raised automatically: nothing to nudge.
  assert.ok(!today({ integrationConnections: [{ id: "c", provider: "stripe", status: "connected", archivedAt: null }] }).act.some((item) => item.id === "connect-payments"));
  assert.ok(!today({ bookingOrchestrations: [plan("wait_for_payment")] }).act.some((item) => item.id === "connect-payments"));
  assert.ok(!today({ bookingOrchestrations: [plan("wait_for_signature", true)] }).act.some((item) => item.id === "connect-payments"));
});

test("connected after the link went out, the signature raises the deposit after all", () => {
  const orchestration = read("functions/src/booking/orchestration.ts");
  assert.match(orchestration, /let raisesRetainer = plan\.get\("policy\.createRetainerAfterSignature"\) === true;/);
  assert.match(orchestration, /await requireProviderForTenant\(db, tenantId, "invoicing"\);\s*raisesRetainer = true;/);
  assert.match(orchestration, /"policy\.createRetainerAfterSignature": true,/);
  // Both readers of the journey pass the plan's answer.
  assert.match(read("components/today/use-today-inbox.ts"), /depositByStudio: depositByStudio\(\s*\(bookingOrchestrations\.records \?\? \[\]\)\.find\(\(plan\) => plan\.id === projectId\),\s*\),/);
  assert.match(read("components/projects/use-project-journey.ts"), /depositByStudio: depositByStudio\(\(bookingPlans\.records \?\? \[\]\)\.find\(\(plan\) => plan\.id === projectId\)\),/);
  // The send dialog says connecting before they sign still works.
  assert.match(read("components/contracts/combined-agreement-send.tsx"), /" before they sign and they pay it on the spot\."/);
});
