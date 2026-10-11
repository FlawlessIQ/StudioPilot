import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { bookedOnceClause, journeyProfile } from "@/features/job-kinds/job-kinds";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";
import { bookingBlockerLabel } from "@/features/booking/gate-requirements";
import { bookingBlockerLabel as blockerLabel } from "@/features/booking/blocker-label";
import { manualAdvanceFor } from "@/features/projects/manual-advance";
import { cueHandoff } from "@/features/today/handoff";
import { explainersFor } from "@/features/help/explainers";
import { glossaryFor, glossaryTerm } from "@/features/help/glossary";
import { scheduleLineLabel } from "@/features/billing/schedule-label";
import { buildCombinedAgreement, sectionDocument } from "@/features/contracts/combined";
import { PAYMENT_SHAPE_LABELS, paymentShapeLabel } from "@/features/job-kinds/job-kinds";
import { paymentShapeLabel as functionsPaymentShapeLabel } from "../functions/src/job-kinds/job-kinds";
import { extraExamples, extraUnitExamples } from "@/features/packages/extra-ideas";
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

/**
 * The hair walk (Priya Shah, Jess Styles Bridal, 2026-10-10): the quote, the
 * package forms, the Library and the client's agreement still spoke a
 * photographer's words in places. A photographer's read exactly as before.
 */
test("the quote composer's deposit field and its ⓘ are the trade's", () => {
  const proposal = read("components/proposals/studio-proposal-workspace.tsx");
  assert.match(proposal, /<small>\s*\{Deposit\} <InfoHint term="retainer" \/>\s*<\/small>/);
  assert.doesNotMatch(proposal, /Retainer <InfoHint term="retainer" \/>/);
  // InfoHint reads the studio's trade, so the ⓘ is the trade's own word.
  assert.match(read("components/ui/info-hint.tsx"), /glossaryTerm\(props\.term, tenantTrade\)/);
  assert.equal(glossaryTerm("retainer", "hair")?.term, "Deposit");
  assert.doesNotMatch(glossaryTerm("retainer", "hair")?.hint ?? "", RETAINER);
  assert.equal(glossaryTerm("retainer", "photographer")?.term, "Retainer");
  // The panel's notes follow it.
  assert.match(proposal, /the \$\{vocab\.deposit\} that holds their date\./);
  assert.match(proposal, /The \$\{vocab\.deposit\} and final balance dates go on the payment plan they see\./);
});

test("a stored \"Retainer\" line reads as the trade's word, and only where it is shown", () => {
  for (const trade of VENDORS) assert.equal(scheduleLineLabel("Retainer", trade), "Deposit");
  assert.equal(scheduleLineLabel("Retainer", "photographer"), "Retainer");
  assert.equal(scheduleLineLabel("Retainer"), "Retainer");
  for (const label of ["Final balance", "Payment in full", "Payment on the day", "Booking fee"])
    assert.equal(scheduleLineLabel(label, "hair"), label);
  assert.match(
    read("components/proposals/studio-proposal-workspace.tsx"),
    /<small>\{scheduleLineLabel\(text\(payment\.label, "Payment"\), workspace\.tenantTrade\)\}<\/small>/,
  );
  assert.match(
    read("components/client/kit/client-proposal.tsx"),
    /title=\{scheduleLineLabel\(text\(payment\.label, "Payment"\), workspace\.tenantTrade\)\}/,
  );
  // A signed agreement's Part 2 is in its document hash, so it keeps the
  // stored label: the swap is never made where it would change a hash.
  const { document, sections } = buildCombinedAgreement(
    { format: 1, title: "Agreement", blocks: [{ type: "paragraph", content: [{ text: "Terms." }] }] },
    {
      currency: "USD",
      lineItems: [{ description: "Bridal hair", quantity: 1, totalCents: 37500, kind: "package" }],
      discountCents: 0,
      taxCents: 0,
      totalCents: 37500,
      paymentSchedule: [
        { label: "Retainer", amountCents: 11250, dueDate: null },
        { label: "Final balance", amountCents: 26250, dueDate: "2027-05-22" },
      ],
    },
    "hair",
  );
  assert.match(JSON.stringify(sectionDocument(document, sections[1]!).blocks), /"label":"Retainer"/);
  assert.doesNotMatch(read("features/contracts/combined.ts"), /scheduleLineLabel/);
});

test("a makeup artist's or hair stylist's package is paid the balance on the day", () => {
  for (const trade of ["makeup", "hair"]) {
    const onTheDay = tradeProfile(trade).journey.balanceOnTheDay;
    assert.equal(paymentShapeLabel("deposit_and_balance", onTheDay), "Deposit to book, balance on the day");
    assert.equal(functionsPaymentShapeLabel("deposit_and_balance", onTheDay), "Deposit to book, balance on the day");
    assert.equal(paymentShapeLabel("paid_in_full", onTheDay), "Paid in full to book");
  }
  for (const trade of ["photographer", "dj"]) {
    const onTheDay = tradeProfile(trade).journey.balanceOnTheDay;
    assert.equal(paymentShapeLabel("deposit_and_balance", onTheDay), "Deposit to book, balance before the day");
  }
  assert.equal(PAYMENT_SHAPE_LABELS.deposit_and_balance, "Deposit to book, balance before the day");
  for (const form of [
    "components/crm/create-package-form.tsx",
    "components/crm/edit-package-form.tsx",
    "components/proposals/one-off-package-form.tsx",
    "components/job-kinds/job-types-settings.tsx",
  ]) {
    const source = read(form);
    assert.match(source, /paymentShapeLabel\(/, form);
    assert.doesNotMatch(source, /PAYMENT_SHAPE_LABELS\[/, form);
  }
  const edit = read("components/crm/edit-package-form.tsx");
  assert.match(edit, /\? "A deposit to book, the balance on the day\."\s*: "A deposit to book, the balance before the day\."/);
});

test("the extras a package form and the Library name are the trade's", () => {
  assert.equal(extraExamples("photographer"), "an engagement session, an extra hour");
  assert.equal(extraExamples(undefined), "an engagement session, an extra hour");
  assert.equal(extraExamples("hair"), "bridesmaid hair, an early start");
  assert.equal(extraExamples("makeup"), "lashes, a touch-up stay");
  assert.equal(extraExamples("dj"), "uplighting, an extra hour");
  for (const trade of VENDORS) {
    assert.doesNotMatch(extraExamples(trade), /engagement/);
    assert.equal(extraUnitExamples(trade), "people, hours");
  }
  assert.equal(extraUnitExamples("photographer"), "people, hours, prints");
  assert.match(read("components/crm/package-add-on-picker.tsx"), /\{` — \$\{extraExamples\(trade\)\} — and they can be suggested here\.`\}/);
  const shelves = read("components/library/library-shelves.tsx");
  assert.match(shelves, /\? `Extras sold on top of a package — \$\{extraExamples\(trade\)\}\.`/);
  assert.doesNotMatch(shelves, /an engagement session/);
  const library = read("components/library/add-on-library.tsx");
  assert.match(library, /`Sold by the unit \(\$\{extraUnitExamples\(workspace\.tenantTrade\)\}\) — pick how many`/);
  assert.doesNotMatch(library, /Sold by the unit \(people, hours, prints\)/);
});

test("a client whose studio bills itself is told the studio sends the deposit invoice", () => {
  const page = read("components/client/kit/client-contract.tsx");
  assert.match(
    page,
    /you sign each part, then \$\{studioName \?\? "your studio"\} sends your \$\{needs\.paidInFull \? "invoice" : "deposit invoice"\}, and paying it books your date\./,
  );
  assert.doesNotMatch(page, /arrange your \$\{needs\.paidInFull/);
  // The quote page says "then", not "right after": the invoice may come later.
  const quote = read("components/client/kit/client-proposal.tsx");
  assert.match(quote, /Signing it accepts them, and then you pay your deposit\./);
  assert.doesNotMatch(quote, /right after/);
});
