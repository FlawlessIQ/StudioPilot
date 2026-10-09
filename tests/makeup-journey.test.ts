import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eventDetailCategory, eventDetailsBlocks, eventDetailsFrom } from "../features/contracts/event-details";
import { STARTER_AGREEMENT, sampleContractSources, starterAgreementFor } from "../features/contracts/sample";
import { glossaryFor } from "../features/help/glossary";
import { examplePackagesFor } from "../features/job-kinds/example-packages";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { extraIdeasFor } from "../features/packages/extra-ideas";
import { canCreateProposalForProject, proposalStageVerdict } from "../features/proposals/eligibility";
import { recommendedFor } from "../features/questionnaires/recommended-templates";
import { tradeProfile, tradeVocab } from "../features/trades/trades";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { inquiryLinkLine } from "../functions/src/intake/inquiry-link";
import { tradeInstruction } from "../functions/src/trades/trade-instruction";

/**
 * Phase 4 of the vendor journeys (docs/vendor-journeys-plan.md): the makeup
 * journey — a quote with no sales call first, the makeup Party list, makeup
 * packages and extras, the agreement's terms, and the kit checklist. Every
 * test also holds a photographer where it was.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a makeup artist's words: quote, all done, kit checklist — a photographer's unchanged", () => {
  const makeup = tradeVocab("makeup");
  assert.equal(makeup.proposal, "Quote");
  assert.equal(makeup.dayDone, "All done");
  assert.equal(makeup.kitChecklist?.title, "Kit checklist");
  assert.ok(makeup.kitChecklist!.items.some((item) => /lashes/.test(item)));
  assert.equal(tradeVocab("hair").proposal, "Quote");
  for (const trade of ["photographer", "dj", undefined]) {
    assert.equal(tradeVocab(trade).proposal, "Proposal", String(trade));
    assert.equal(tradeVocab(trade).kitChecklist, null, String(trade));
    assert.equal(tradeProfile(trade).consultation, true, String(trade));
  }
  assert.equal(tradeProfile("makeup").consultation, false);
  assert.equal(tradeProfile("hair").consultation, false);
});

const base: JourneyInput = {
  projectId: "p1",
  state: "LEAD",
  eventDate: "2026-10-20",
  today: "2026-06-01",
  lead: null,
  hasConsultation: false,
  proposalStatus: null,
  contractStatus: null,
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
};

test("a makeup inquiry goes straight to the quote; a photographer's still books the consultation", () => {
  const makeup = projectJourney({ ...base, trade: "makeup" });
  assert.ok(!makeup.steps.some((step) => step.key === "consultation"));
  const quote = makeup.steps.find((step) => step.key === "proposal");
  assert.equal(quote?.title, "Quote");
  assert.equal(quote?.status, "current");
  assert.equal(quote?.action?.label, "Prepare quote");
  assert.equal(makeup.current?.key, "proposal");

  const photo = projectJourney(base);
  assert.equal(photo.current?.key, "consultation");
  assert.equal(photo.steps.find((step) => step.key === "proposal")?.title, "Proposal");
  // A call a makeup studio did book stays on its journey.
  assert.ok(projectJourney({ ...base, trade: "makeup", hasConsultation: true }).steps.some((step) => step.key === "consultation"));
});

test("the quote can be made from an inquiry, in the composer and on the server", () => {
  const project = { state: "LEAD", eventKind: "wedding" };
  assert.equal(canCreateProposalForProject("LEAD", project, "makeup"), true);
  assert.equal(canCreateProposalForProject("LEAD", project, "hair"), true);
  assert.equal(canCreateProposalForProject("LEAD", project, "photographer"), false);
  assert.equal(canCreateProposalForProject("LEAD", project), false);
  assert.equal(proposalStageVerdict(project, "makeup"), "ready");
  assert.equal(proposalStageVerdict(project), "too_early");
  // The server steps the job through CONSULTATION as it creates the quote.
  const server = read("functions/src/booking/proposals.ts");
  // One profile decides (job-kinds.ts journeyFor): no call, or an optional one.
  assert.match(server, /!journeyFor\(\s*projectProfile\(project\.data\(\)\),\s*tradeProfile\(\(await transaction\.get\(db\.doc\(`tenants\/\$\{command\.tenantId\}`\)\)\)\.get\("trade"\)\),\s*\)\.callRequired;/);
  // A DJ's vibe call is optional: the quote can go first too.
  assert.equal(canCreateProposalForProject("LEAD", project, "dj"), true);
  for (const path of ["components/proposals/studio-proposal-workspace.tsx", "components/booking/project-booking-workspace.tsx", "components/booking/booking-autopilot-workspace.tsx"])
    assert.match(read(path), /workspace\.tenantTrade\)/, path);
  // No "invite them to book a call" card, and no "Confirm we've spoken".
  assert.match(read("components/projects/live-project-detail.tsx"), /const offersConsultation = projectProfile\(project\)\.consultation && tradeProfile\(workspace\.tenantTrade\)\.consultation;/);
});

test("the couple's link and page take their details and promise the price, not a call", () => {
  assert.match(inquiryLinkLine("https://x.test/i/1", false, "wedding", "makeup"), /we'll send your price/);
  assert.match(inquiryLinkLine("https://x.test/i/1", false, "wedding", "photographer"), /pick a time to talk/);
  assert.match(inquiryLinkLine("https://x.test/i/1", false, "wedding"), /pick a time to talk/);
  assert.match(read("functions/src/intake/inquiry-link.ts"), /tenant\.get\("trade"\),/);
  assert.match(read("functions/src/booking/public-scheduling.ts"), /offersConsultation: kindProfile\.consultation && tradeProfile\(tenant\.get\("trade"\)\)\.consultation,/);
});

test("Cue is told there is no sales call and to call it a quote; a DJ's instruction is unchanged", () => {
  const makeup = tradeInstruction("makeup");
  assert.match(makeup, /There is no sales call/);
  assert.match(makeup, /Call the proposal a quote/);
  assert.doesNotMatch(makeup, /Call the sales call a consultation/);
  const dj = tradeInstruction("dj");
  assert.match(dj, /Call the sales call a vibe call/);
  assert.doesNotMatch(dj, /no sales call|quote/);
  assert.equal(tradeInstruction("photographer"), "");
});

const brand = { studioName: "Glow by Ana", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("the client gets a quote, and nothing says photography; a photographer's email is unchanged", () => {
  const values = { actionUrl: "https://studio-cue.com/client/proposal", eventKind: "wedding" };
  const quote = renderEmailTemplate({ key: "proposal_sent", brand, recipientName: "Maya", values: { ...values, trade: "makeup" } });
  assert.equal(quote.subject, "Your quote from Glow by Ana");
  assert.match(quote.text, /Your quote is ready to review/);
  assert.match(quote.text, /Review quote/);
  // The portal's address is the only "proposal" left in it.
  assert.doesNotMatch(quote.text.replace(/https?:\/\/\S+/g, ""), /proposal|photograph/i);
  const photo = renderEmailTemplate({ key: "proposal_sent", brand, recipientName: "Maya", values });
  assert.equal(photo.subject, "Your proposal from Glow by Ana");
  assert.match(photo.text, /Review your photography proposal and pricing|Your proposal is ready to review/);
  const agreement = renderEmailTemplate({ key: "contract_sent", brand, recipientName: "Maya", values: { ...values, trade: "makeup" } });
  assert.doesNotMatch(agreement.text, /photograph/i);
  assert.match(renderEmailTemplate({ key: "contract_sent", brand, recipientName: "Maya", values }).text, /photography agreement/);
  // The portal page says quote too.
  assert.match(read("components/client/kit/client-proposal.tsx"), /const offerWord = tradeVocab\(workspace\.tenantTrade\)\.proposal;/);
});

test("the crew's reminder carries the kit checklist and the getting-ready schedule", () => {
  const values = { trade: "makeup", role: "Makeup artist", callDate: "2026-10-20", runOfShowShared: true, actionUrl: "https://studio-cue.com/crew" };
  const reminder = renderEmailTemplate({ key: "crew_reminder", brand, recipientName: "Jess", values });
  assert.match(reminder.text, /Kit checklist — before you leave, check the address, room number and parking;/);
  assert.match(reminder.text, /The getting-ready schedule, who to call/);
  const photo = renderEmailTemplate({ key: "crew_reminder", brand, recipientName: "Jess", values: { ...values, trade: undefined } });
  assert.doesNotMatch(photo.text, /Kit checklist/);
  assert.match(photo.text, /The run of show, who to call/);
});

test("the kit is what the morning says the day before; the day reads All done", () => {
  const ready = { ...base, state: "READY", hasConsultation: true, proposalStatus: "accepted", contractStatus: "completed", retainerInvoiceStatus: "paid", finalInvoiceStatus: "paid", questionnaireStatus: "submitted", questionnaireHasAnswers: true, scheduleStatus: "approved", scheduleHasUsableItems: true, insuranceRequired: "not_required" };
  // Not a step of its own any more (simpler vendor journeys): the day before,
  // "The morning" says what to pack; the crew's reminder carries the list.
  const dayBefore = projectJourney({ ...ready, trade: "makeup", today: "2026-10-19" });
  assert.ok(!dayBefore.steps.some((step) => step.key === ("kit" as never)));
  const morning = dayBefore.steps.find((step) => step.key === "event_day");
  assert.equal(morning?.title, "The morning");
  assert.match(String(morning?.detail), /^Pack .*— and check the address, room number and parking$/);
  assert.equal(projectJourney({ ...ready, trade: "makeup", today: "2026-10-10" }).steps.find((step) => step.key === "event_day")?.detail, ready.eventDate);
  const after = projectJourney({ ...ready, state: "EVENT_COMPLETE", trade: "makeup", today: "2026-10-21" });
  assert.equal(after.steps.find((step) => step.key === "event_day")?.detail, "All done");
  // A photographer's and a DJ's day say no such thing.
  for (const trade of [undefined, "dj"] as const)
    assert.doesNotMatch(String(projectJourney({ ...ready, trade, today: "2026-10-19" }).steps.find((step) => step.key === "event_day")?.detail), /^Pack /, String(trade));
});

test("the makeup Party list asks about the bride's skin and lashes; the hair one doesn't", () => {
  const makeup = recommendedFor("makeup").find((form) => form.id === "makeup-party-list")!;
  const skin = makeup.sections.find((section) => section.id === "your-skin");
  assert.deepEqual(skin?.fields.map((field) => field.id), ["skin-type", "skin-notes", "lashes"]);
  assert.ok(skin!.fields[0]!.options.includes("Sensitive"));
  const hair = recommendedFor("hair").find((form) => form.id === "hair-party-list")!;
  assert.ok(!hair.sections.some((section) => section.id === "your-skin"));
  // Both keep the morning and the party, which the chair schedule reads.
  for (const form of [makeup, hair]) {
    const ids = form.sections.flatMap((section) => section.fields.map((field) => field.id));
    for (const id of ["ready-by-time", "earliest-start-time", "getting-ready", "party-list", "allergies-notes"]) assert.ok(ids.includes(id), `${form.id} ${id}`);
  }
});

test("makeup packages and extras: the bride's package, everyone else per person", () => {
  assert.deepEqual(examplePackagesFor("makeup", "wedding").map((example) => example.name), ["Bridal makeup", "Bridal makeup with trial"]);
  assert.deepEqual(examplePackagesFor("makeup", "corporate").map((example) => example.name), ["Event makeup"]);
  assert.deepEqual(examplePackagesFor("photographer", "wedding").map((example) => example.name), ["Full-day wedding", "Elopement"]);
  const ideas = extraIdeasFor("makeup");
  const perUnit = Object.fromEntries(ideas.map((idea) => [idea.name, idea.perUnit]));
  assert.equal(perUnit["Bridesmaid makeup"], "person");
  assert.equal(perUnit["Lashes"], "person");
  assert.equal(perUnit["Airbrush makeup"], "person");
  assert.equal(perUnit["Touch-up stay"], "hour");
  assert.equal(perUnit["Travel"], null);
  for (const name of ["Mother of the bride makeup", "Flower girl makeup", "Early start", "Extra artist"]) assert.ok(name in perUnit, name);
  // A photographer's one-off extras are the ones the editor always offered,
  // and the library form offers no examples to a photographer.
  assert.deepEqual(extraIdeasFor("photographer").map((idea) => idea.name), [
    "Engagement shoot", "Photo booth", "Boudoir session", "Extra hour of coverage", "Second shooter", "Rehearsal dinner", "Parent albums",
  ]);
  assert.match(read("components/library/add-on-library.tsx"), /const ideas = photo \? \[\] : extraIdeasFor\(workspace\.tenantTrade\);/);
  for (const idea of [...extraIdeasFor("makeup"), ...extraIdeasFor("hair"), ...extraIdeasFor("dj")])
    assert.doesNotMatch(`${idea.name} ${idea.description}`, /photo/i, idea.name);
});

test("a makeup artist's agreement starts from the terms a beauty booking needs", () => {
  const makeup = starterAgreementFor("makeup");
  assert.equal(makeup.title, "Makeup Services Agreement");
  for (const heading of ["Minimum and party size", "The morning", "Trial", "Allergies and skin", "No-shows and cancellation"])
    assert.match(makeup.body, new RegExp(`## \\d\\. ${heading}`), heading);
  assert.match(makeup.body, /people can be added after the final headcount, but not taken off/);
  assert.doesNotMatch(makeup.body, /image|copyright|photograph/i);
  assert.equal(starterAgreementFor("hair").title, "Hair Services Agreement");
  assert.deepEqual(starterAgreementFor("photographer"), { title: "Photography Services Agreement", body: STARTER_AGREEMENT });
  assert.deepEqual(starterAgreementFor(undefined), { title: "Photography Services Agreement", body: STARTER_AGREEMENT });
  assert.match(starterAgreementFor("dj").body, /## 4\. Equipment and the venue/);
  assert.match(read("components/contracts/agreement-editor.tsx"), /\.\.\.starterAgreementFor\(workspace\.tenantTrade\),/);
  // The preview shows a bride and her party, paid on the day.
  const sample = sampleContractSources("Glow by Ana", "2026-10-08", "makeup");
  assert.equal(sample.package.coverage, "2 makeup artists");
  assert.equal(sample.paymentSchedule.at(-1)?.dueDate, sample.event.date);
  assert.equal(sampleContractSources("Studio", "2026-10-08").package.coverage, "2 photographers, 8 hours");
});

test("Schedule A for makeup: where and when they get ready, the party size, and a headcount that only grows", () => {
  const answers = [
    { question: "Where you're getting ready", answer: "The Lodge — bridal suite" },
    { question: "When does everyone need to be ready?", answer: "1:00 PM" },
    { question: "How many people need makeup, including you?", answer: "6" },
  ];
  const details = eventDetailsFrom({ eventType: "Wedding", eventKind: "wedding", date: "June 12, 2027", venue: "The Lodge", coverage: null, answers, lockDaysBefore: 30, trade: "makeup" });
  assert.deepEqual(details.missing, []);
  const rows = Object.fromEntries(details.rows.map((row) => [row.label, row.value]));
  assert.equal(rows["Getting ready"], "The Lodge — bridal suite");
  assert.equal(rows["Times"], "1:00 PM");
  assert.equal(rows["Party size"], "6");
  // No ceremony or reception owed by a makeup artist's agreement.
  assert.ok(!details.rows.some((row) => row.label === "Reception"));
  const paragraph = eventDetailsBlocks(details)[1] as { content: Array<{ text: string }> };
  assert.match(paragraph.content[0]!.text, /people can be added but not taken off/);
  // A photographer's Schedule A reads these questions exactly as before.
  assert.equal(eventDetailCategory("How many people need makeup, including you?"), null);
  assert.equal(eventDetailCategory("When does everyone need to be ready?"), null);
  const photo = eventDetailsFrom({ eventType: "Wedding", eventKind: "wedding", date: null, venue: null, coverage: null, answers, lockDaysBefore: 28 });
  assert.ok(photo.missing.includes("Ceremony"));
  assert.equal(photo.headcountLock, undefined);
  assert.doesNotMatch((eventDetailsBlocks(photo)[1] as { content: Array<{ text: string }> }).content[0]!.text, /taken off/);
});

test("help speaks to a makeup artist", () => {
  const ids = glossaryFor("studio", "makeup").map((term) => term.id);
  for (const id of ["beauty-quote", "beauty-trial", "party-list", "headcount-lock", "getting-ready-schedule", "kit-checklist"]) assert.ok(ids.includes(id), id);
  assert.ok(!glossaryFor("studio").some((term) => term.id === "kit-checklist"));
  assert.ok(!glossaryFor("studio", "dj").some((term) => term.id === "party-list"));
});
