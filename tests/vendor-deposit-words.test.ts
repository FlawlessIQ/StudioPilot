import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tradeVocab } from "@/features/trades/trades";
import { bookedOnceClause, journeyProfile } from "@/features/job-kinds/job-kinds";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";
import { bookingBlockerLabel } from "@/features/booking/gate-requirements";
import { bookingBlockerLabel as blockerLabel } from "@/features/booking/blocker-label";
import { manualAdvanceFor } from "@/features/projects/manual-advance";
import { cueHandoff } from "@/features/today/handoff";
import { explainersFor } from "@/features/help/explainers";
import { glossaryFor } from "@/features/help/glossary";
import { buildClientMilestones } from "../server/client/portal-experience";
import { emailTemplateKeys, renderEmailTemplate } from "../functions/src/communications/email-templates";
import { tradeVocab as functionsVocab } from "../functions/src/trades/trades";
import { tradeInstruction } from "../functions/src/trades/trade-instruction";

/**
 * The vendor wording sweep (Conor, 2026-10-10): a DJ's, makeup artist's or
 * hair stylist's client pays a deposit, never a retainer — in every email,
 * the portal, the job's steps, Today, Cue and the help. A photographer's
 * words are exactly as they were. Found walking Riley Park's DJ booking on
 * prod, where the booked email said "Your signed agreement and retainer are
 * both in".
 */

const VENDORS = ["dj", "makeup", "hair"] as const;
const RETAINER = /\bretainers?\b/i;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the trade's word for the payment that books the date", () => {
  assert.equal(tradeVocab("photographer").deposit, "retainer");
  assert.equal(tradeVocab(undefined).deposit, "retainer");
  for (const trade of VENDORS) {
    assert.equal(tradeVocab(trade).deposit, "deposit");
    assert.equal(functionsVocab(trade).deposit, "deposit");
  }
});

test("no email a vendor's client or studio receives says retainer", () => {
  const brand = { studioName: "Spin Theory DJs", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  for (const trade of VENDORS) {
    for (const key of emailTemplateKeys) {
      for (const extra of [{}, { combined: true }, { combined: true, payOnline: false }]) {
        const email = renderEmailTemplate({
          key,
          brand,
          recipientName: "Riley Park",
          projectName: "Riley Park Wedding",
          values: { trade, actionUrl: "https://studio-cue.com/x", portalUrl: "https://studio-cue.com/client", invoiceUrl: "https://studio-cue.com/i", ...extra },
        });
        const visible = `${email.subject}\n${email.preheader}\n${email.text}`;
        assert.doesNotMatch(visible, RETAINER, `${trade} · ${key} ${JSON.stringify(extra)}`);
      }
    }
  }
  // The one Riley got, and a photographer's exactly as before.
  const booked = (trade: string) =>
    renderEmailTemplate({ key: "booking_confirmation", brand, recipientName: "Riley Park", projectName: "Riley Park Wedding", values: { trade } }).text;
  assert.match(booked("dj"), /Your signed agreement and deposit are both in for Riley Park Wedding/);
  assert.match(booked("photographer"), /Your signed agreement and retainer are both in for Riley Park Wedding/);
  const invoice = renderEmailTemplate({ key: "retainer_invoice", brand, recipientName: "Riley", values: { trade: "makeup", invoiceUrl: "https://x.test/i" } });
  assert.equal(invoice.subject, "Deposit from Spin Theory DJs");
});

test("the client portal: a deposit, and an optional call is never ticked off unheld", () => {
  for (const trade of VENDORS) {
    const booking = buildClientMilestones("RETAINER_PENDING", { trade, consultation: true }).find((step) => step.id === "booking");
    assert.doesNotMatch(booking?.description ?? "", RETAINER);
    assert.doesNotMatch(booking?.description ?? "", /all in one visit/);
  }
  // Riley's portal showed "Vibe call ✓" for a call that never took place.
  const ids = (state: string) => buildClientMilestones(state, { trade: "dj", consultation: true }).map((step) => step.id);
  assert.ok(ids("LEAD").includes("consultation"), "offered while it can still happen");
  assert.ok(!ids("RETAINER_PENDING").includes("consultation"), "gone once booking has moved past it");
  // A photographer's consultation is required, and stays ticked.
  const photo = buildClientMilestones("RETAINER_PENDING", { trade: "photographer", consultation: true });
  assert.equal(photo.find((step) => step.id === "consultation")?.status, "complete");
  assert.equal(photo.find((step) => step.id === "booking")?.description, "Review your offer, agreement, and retainer.");
});

const signed = (trade: string): JourneyInput => ({
  projectId: "job1",
  state: "RETAINER_PENDING",
  eventDate: "2027-09-18",
  today: "2026-10-10",
  lead: null,
  hasConsultation: false,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: null,
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

test("the job's steps, the booking check and manual moves say deposit", () => {
  for (const trade of VENDORS) {
    const journey = projectJourney(signed(trade));
    for (const step of journey.steps) {
      const action = step.action?.kind === "link" ? step.action.label : "";
      assert.doesNotMatch(`${step.title} ${step.detail} ${action}`, RETAINER, `${trade} · ${step.key}`);
    }
    assert.equal(bookingBlockerLabel("retainerSatisfied", trade), "the deposit isn't paid");
    assert.equal(blockerLabel("retainerSatisfied", trade), "the deposit payment");
    assert.equal(manualAdvanceFor("RETAINER_PENDING", "BOOKED", "job1", trade)?.label, "Record the deposit");
  }
  const photo = projectJourney(signed("photographer")).steps.find((step) => step.key === "retainer");
  assert.equal(photo?.title, "Retainer paid");
  assert.deepEqual(photo?.action, { kind: "link", label: "Create retainer invoice", href: "/studio/contracts?project=job1" });
  assert.equal(bookingBlockerLabel("retainerSatisfied"), "the retainer isn't paid");
  assert.equal(manualAdvanceFor("RETAINER_PENDING", "BOOKED", "job1")?.label, "Record the retainer");
  // The Booking tab's confirm line and Cue's confirm card (prod, Riley Park, 2026-10-10).
  assert.equal(bookedOnceClause(journeyProfile("wedding"), tradeVocab("dj").deposit), "the agreement is signed and the deposit is paid");
  assert.equal(bookedOnceClause(journeyProfile("wedding")), "the agreement is signed and the retainer is paid");
});

test("Today's hand-off line and Cue's instruction say deposit", () => {
  const now = "2026-10-10T12:00:00.000Z";
  const input = {
    now,
    emailJobs: [
      { id: "e1", type: "retainer_invoice", status: "succeeded", completedAt: "2026-10-10T11:00:00.000Z", projectId: "job1", invoiceId: "inv1", recipientName: "Riley Park" },
    ],
    projects: [{ id: "job1", name: "Riley Park Wedding" }],
    invoiceReferences: [{ id: "inv1", createdBy: "booking-orchestrator" }],
  };
  const dj = cueHandoff({ ...input, tenantTrade: "dj" }).map((item) => item.line);
  const photo = cueHandoff(input).map((item) => item.line);
  assert.ok(dj.length === 1 && /deposit invoice/.test(dj[0]!) && !RETAINER.test(dj[0]!), dj.join(" | "));
  assert.ok(photo.length === 1 && /retainer invoice/.test(photo[0]!), photo.join(" | "));
  for (const trade of VENDORS) assert.match(tradeInstruction(trade), /Call the retainer a deposit, to the operator and to clients\./);
  assert.equal(tradeInstruction("photographer"), "");
});

test("a vendor's help says deposit everywhere but its ids and links", () => {
  for (const trade of VENDORS) {
    for (const guide of explainersFor(trade)) {
      const words = [guide.title, guide.summary, guide.purpose, ...guide.steps, guide.next ?? "", ...(guide.goodToKnow ?? [])];
      for (const line of words) assert.doesNotMatch(line, RETAINER, `${trade} · ${guide.id}: ${line}`);
    }
    for (const audience of ["studio", "couple", "crew"] as const)
      for (const word of glossaryFor(audience, trade)) assert.doesNotMatch(`${word.term} ${word.hint}`, RETAINER, `${trade} · ${word.id}`);
  }
  assert.equal(glossaryFor("studio", "dj").find((word) => word.id === "retainer")?.term, "Deposit");
  assert.equal(glossaryFor("studio", "photographer").find((word) => word.id === "retainer")?.term, "Retainer");
});

test("the studio's screens take the trade's word, labels both spelled out", () => {
  const forms = [read("components/crm/create-package-form.tsx"), read("components/crm/edit-package-form.tsx")];
  for (const form of forms) assert.match(form, /deposit === "deposit" \? "Deposit type" : "Retainer type"/);
  const waive = read("components/booking/book-without-retainer.tsx");
  assert.match(waive, /"Booking without a deposit\? Waive it" : "Booking without a retainer\? Waive it"/);
  assert.match(waive, /"Confirm the booking without a deposit" : "Confirm the booking without a retainer"/);
  const proposal = read("components/proposals/studio-proposal-workspace.tsx");
  assert.equal((proposal.match(/=== "deposit" \? "Deposit due" : "Retainer due"/g) ?? []).length, 2);
  const booking = read("components/booking/project-booking-workspace.tsx");
  assert.match(booking, /const depositWord = tradeVocab\(workspace\.tenantTrade\)\.deposit;/);
  assert.doesNotMatch(booking, /"Paid straight after signing"/, "with the studio invoicing, it isn't straight after");
  assert.match(read("components/booking/invoice-corrections.tsx"), /invoice\.kind === "final" \? "final balance" : tradeVocab\(trade\)\.deposit;/);
  assert.match(read("components/client/kit/client-payments.tsx"), /if \(value === "retainer"\) \{\s*const word = tradeVocab\(trade\)\.deposit;/);
  assert.match(read("components/ai/actions/booking-actions.tsx"), /const deposit = tradeVocab\(cardTrade\)\.deposit;/);
});
