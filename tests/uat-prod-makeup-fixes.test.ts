import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { contractExtras } from "../functions/src/contracts/sources";
import { formInquiryDetails } from "../functions/src/intake/new-inquiry-alert";
import { proposalPdfDetail } from "../features/proposals/pdf-notice";
import { todayInbox } from "../features/today/inbox";
import { buildClientMilestones, buildClientPortalExperience } from "../server/client/portal-experience";
import { bookingSteps } from "../features/client/booking-steps";
import { clientAreaItems } from "../features/client/portal-navigation";

/**
 * What walking a makeup wedding on production found (UAT round 3,
 * 2026-10-09): Glow by Ana, Maya Brooks, studio-cue.com.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const brand = { studioName: "Glow by Ana", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const html = (key: string, trade?: string) => renderEmailTemplate({ key, brand, recipientName: "Maya", values: { trade, actionUrl: "https://studio-cue.com/x", portalUrl: "https://studio-cue.com/client" } });

test("a makeup inquiry, answered, puts the quote on Today — not 'Nothing needs you'", () => {
  const now = "2026-10-09T13:00:00.000Z";
  const base = {
    now,
    projects: [{ id: "job1", tenantId: "t", name: "Maya Brooks Wedding", state: "LEAD", eventDate: "2027-06-12", eventKind: "wedding" }],
    leads: [{ id: "lead1", tenantId: "t", projectId: "job1", status: "converted", firstName: "Maya", lastName: "Brooks", eventDate: "2027-06-12", createdAt: "2026-10-09T12:22:00.000Z" }],
    conversations: [{ id: "c1", projectId: "job1", leadId: "lead1", lastOutboundAt: "2026-10-09T12:23:00.000Z", lastInboundAt: "2026-10-09T12:22:00.000Z" }],
    proposals: [],
  };
  const makeup = todayInbox({ ...base, tenantTrade: "makeup" } as never);
  const card = [...makeup.act, ...(makeup.approve ?? [])].find((item) => item.id === "quote-owed-job1");
  assert.equal(card?.title, "Send Maya Brooks your quote");
  assert.equal(card?.action?.kind === "link" ? card.action.href : null, "/studio/proposals/new?project=job1");
  // Once the quote exists, the card goes.
  const quoted = todayInbox({ ...base, tenantTrade: "makeup", proposals: [{ id: "p1", projectId: "job1", status: "draft" }] } as never);
  assert.ok(![...quoted.act].some((item) => item.id === "quote-owed-job1"));
  // A photographer's wedding waits for the couple to book the call, as before.
  const photo = todayInbox({ ...base, tenantTrade: "photographer" } as never);
  assert.ok(![...photo.act].some((item) => item.id === "quote-owed-job1"));
  // A photographer's family session has no call either: the price is owed.
  const family = todayInbox({ ...base, tenantTrade: "photographer", projects: [{ ...base.projects[0], eventKind: "portraits" }] } as never);
  assert.equal([...family.act].find((item) => item.id === "quote-owed-job1")?.title, "Send Maya Brooks your proposal");
});

test("a makeup inquiry is never 'Looking for: Photography'", () => {
  const server = read("functions/src/crm/public-lead.ts");
  assert.match(server, /const servicesRequested = studioTrade\.family === "photo" \? input\.servicesRequested : \(\["other"\]/);
  assert.doesNotMatch(server, /servicesRequested: input\.servicesRequested,/);
  const rows = formInquiryDetails({
    email: "m@x.test", phone: null, partnerName: null, eventTypeLabel: "Wedding", venue: null, city: "Montclair, NJ", estimatedGuestCount: null,
    servicesRequested: ["other"], budgetRange: null, referralSource: null, coiRequired: null, venueContactName: null, venueContactEmail: null, answers: [],
  });
  assert.ok(!rows.some((row) => row.label === "Looking for"));
  // The public form's tab names the studio's trade.
  assert.match(read("app/inquiry/page.tsx"), /TRADE_LABELS\[tenant\.trade\]\} inquiry · \$\{tenant\.name\}/);
});

test("a vendor's client emails never say photography: previews and the footer", () => {
  for (const [key, photoLine] of [
    ["client_invitation", "Your secure photography project portal is ready."],
    ["booking_confirmation", "Your photography project is officially booked."],
  ] as const) {
    const makeup = html(key, "makeup");
    assert.doesNotMatch(makeup.html ?? "", /photograph/i, key);
    assert.match(html(key).html ?? "", new RegExp(photoLine.replace(".", "\\.")), `${key} unchanged for a photographer`);
  }
  assert.match(html("questionnaire_request", "makeup").html ?? "", /Complete your Party list\./);
  assert.match(html("questionnaire_request", "dj").html ?? "", /Complete your Music &amp; moments planner\.|Complete your Music & moments planner\./);
  assert.match(html("booking_confirmation").html ?? "", /private studio workspace or photography project/);
  assert.match(html("booking_confirmation", "hair").html ?? "", /private studio workspace or project\./);
});

test("the new-inquiry alert asks a makeup artist for a quote, not a talk", () => {
  const alert = renderEmailTemplate({ key: "studio_new_inquiry", brand, recipientName: "Ana", values: { trade: "makeup", coupleName: "Maya Brooks", firstName: "Maya" } });
  assert.match(alert.text, /would like a quote/);
  assert.match(renderEmailTemplate({ key: "studio_new_inquiry", brand, recipientName: "Ana", values: { coupleName: "Maya Brooks", firstName: "Maya" } }).text, /would like to talk/);
});

test("the quote's PDF and the studio's own buttons say quote", () => {
  const pdf = read("functions/src/operations/ai-pdf.ts");
  assert.match(pdf, /\$\{TRADE_LABELS\[pdfTrade\.trade\]\.toUpperCase\(\)\} \$\{tradeVocab\(pdfTrade\.trade\)\.proposal\.toUpperCase\(\)\}/);
  assert.match(pdf, /package_description:pdfTrade\.family!=="photo"\?"Services and what's included, as selected\."/);
  assert.match(pdf, /-\$\{tradeVocab\(\(await getFirestore\(\)\.doc\(`tenants\/\$\{tenantId\}`\)\.get\(\)\)\.get\("trade"\)\)\.proposal\.toLowerCase\(\)\}-v/);
  assert.equal(proposalPdfDetail("ready", "quote"), "Stored privately until this quote is sent.");
  assert.equal(proposalPdfDetail("ready"), "Stored privately until this proposal is sent.");
  const page = read("components/proposals/studio-proposal-workspace.tsx");
  assert.match(page, /offer === "proposal" \? "Approve this proposal" : `Approve this \$\{offer\}`/);
  assert.match(page, /offer === "proposal" \? "Send proposal" : `Send \$\{offer\}`/);
  assert.match(read("components/booking/booking-autopilot-workspace.tsx"), /`The \$\{tradeVocab\(workspace\.tenantTrade\)\.proposal\.toLowerCase\(\)\} is accepted\.`/);
});

test("the agreement counts bridesmaids as people, and says when this trade's details lock", () => {
  assert.deepEqual(contractExtras([{ name: "Bridesmaid makeup", quantity: 4, unitPriceCents: 12000, unitLabel: "person" }], "USD"), ["Bridesmaid makeup — 4 people (extra, $480.00)"]);
  assert.deepEqual(contractExtras([{ name: "Album spreads", quantity: 2, unitPriceCents: 15000 }], "USD"), ["Album spreads ×2 (extra, $300.00)"]);
  const step = read("components/contracts/native-contract-step.tsx");
  assert.match(step, /const lockDays = tradeProfile\(workspace\.tenantTrade\)\.planning\?\.lockDaysBefore \?\? 28;/);
  assert.match(step, /confirmed with the final details \$\{lockWhen\} before/);
});

test("a makeup client's journey has no consultation and no photographs to receive", () => {
  const makeup = buildClientMilestones("BOOKED", { trade: "makeup" });
  assert.deepEqual(makeup.map((step) => step.id), ["inquiry", "booking", "planning", "event", "delivery"]);
  assert.doesNotMatch(JSON.stringify(makeup), /photograph|coverage|consultation/i);
  assert.equal(makeup.find((step) => step.id === "delivery")?.label, "Afterwards");
  // With no call, booking is where a new inquiry stands.
  assert.equal(buildClientMilestones("LEAD", { trade: "makeup" }).find((step) => step.status === "current")?.id, "booking");
  // A DJ keeps the call, by its own name; a photographer's family session drops it.
  assert.equal(buildClientMilestones("LEAD", { trade: "dj" }).find((step) => step.id === "consultation")?.label, "Vibe call");
  assert.ok(!buildClientMilestones("LEAD", { trade: "photographer", consultation: false }).some((step) => step.id === "consultation"));
  // A photographer's wedding is the journey it always was.
  const photo = buildClientMilestones("LEAD");
  assert.deepEqual(photo.map((step) => step.id), ["inquiry", "consultation", "booking", "planning", "event", "delivery"]);
  assert.equal(photo.at(-1)?.description, "Receive and access your finished photographs.");
});

test("a booked client is never told their next step is 'Retainer paid'", () => {
  // The starter checkpoints are never ticked in storage (readiness reads the
  // records), so every one read "ready" on Maya's job an hour after booking.
  const starter = (templateKey: string, name: string) => ({ templateKey, name, description: `${name} must be verified before event readiness.`, status: "ready", dueDate: null, ownerType: "client" });
  const checkpoints = [
    starter("contract-completed", "Contract completed"),
    starter("retainer-paid", "Retainer paid"),
    starter("questionnaire-complete", "Questionnaire complete"),
    starter("final-balance", "Final balance paid"),
    starter("schedule-approved", "Final run of show approved"),
  ];
  const booked = (extra: Record<string, unknown> = {}) =>
    buildClientPortalExperience({ state: "BOOKED", availability: { questionnaire: true }, checkpoints, trade: "makeup", consultation: true, ...extra });
  // Her party list is in: nothing is hers to do.
  const sent = booked({ questionnaireStatus: "submitted" }).nextClientAction;
  assert.equal(sent.responsibility, "studio");
  assert.doesNotMatch(sent.name, /Retainer|Questionnaire|Final balance/);
  // Not yet sent: the form is the step, by a client's words.
  const owed = booked({ questionnaireStatus: "assigned" }).nextClientAction;
  assert.equal(owed.href, "/client/questionnaire");
  assert.equal(owed.name, "Continue planning your event");
  // A balance invoiced and not yet late beats "nothing needed from you".
  const billed = booked({ questionnaireStatus: "submitted", outstandingBalance: { amountLabel: "$650.00", dueDate: "2027-05-13", dueDateLabel: "May 13, 2027", overdue: false } }).nextClientAction;
  assert.equal(billed.name, "Pay your balance");
  assert.match(billed.description, /\$650\.00 is due by May 13, 2027/);
  // A step the studio wrote itself is still taken at its word.
  const own = booked({ questionnaireStatus: "submitted", checkpoints: [{ name: "Send us your venue's parking info", description: null, status: "ready", dueDate: null, ownerType: "client" }] }).nextClientAction;
  assert.equal(own.name, "Send us your venue's parking info");
});

test("a makeup client is quoted, and her portal says so", () => {
  const quote = buildClientPortalExperience({ state: "PROPOSAL", availability: {}, checkpoints: [], trade: "makeup" });
  assert.equal(quote.clientStage, "Reviewing your quote");
  assert.equal(quote.nextClientAction.name, "Your studio is preparing your quote");
  const done = buildClientPortalExperience({ state: "EVENT_COMPLETE", availability: {}, checkpoints: [], trade: "makeup" });
  assert.doesNotMatch(done.nextClientAction.name + done.nextClientAction.description, /photograph|image/i);
  assert.equal(buildClientPortalExperience({ state: "PROPOSAL", availability: {}, checkpoints: [] }).clientStage, "Reviewing your proposal");
  // The route hands it the studio's trade and the kind's call.
  const route = read("app/api/client/portal/route.ts");
  assert.match(route, /trade: tenantSnapshot\.get\("trade"\),\s*consultation: projectProfile\(projectSnapshot\.data\(\)\)\.consultation,/);
  assert.match(route, /templateKey: safeString\(document\.get\("templateKey"\)\),/);
  assert.match(read("app/client/layout.tsx"), /default: "Your project",\s*template: "%s · Your project",/);
  assert.match(read("components/client/kit/client-contract.tsx"), /\{TRADE_LABELS\[tradeOf\(workspace\.tenantTrade\)\]\} services agreement/);
});

test("a makeup client's plan and booking steps say quote", () => {
  const nav = { proposal: true, package: false, contract: true, payments: true, questionnaire: false, schedule: false, files: false, delivery: false, reviews: false };
  assert.ok(clientAreaItems(nav, "Quote").some((item) => item.label === "Your quote"));
  assert.ok(clientAreaItems(nav).some((item) => item.label === "Your proposal"));
  const open = bookingSteps({ proposalStatus: "sent", contractStatus: null, retainer: null, offer: "quote" });
  assert.equal(open.steps[0]?.label, "Accept your quote");
  assert.equal(open.next.title, "Review and accept your quote");
  assert.equal(bookingSteps({ proposalStatus: "sent", contractStatus: null, retainer: null }).next.title, "Review and accept your proposal");
  assert.match(read("components/client/live-client-views.tsx"), /offer = tradeVocab\(useWorkspace\(\)\.tenantTrade\)\.proposal\.toLowerCase\(\)/);
  assert.match(read("components/client/kit/client-plan.tsx"), /clientAreaItems\(project\?\.navigation, tradeVocab\(workspace\.tenantTrade\)\.proposal\)/);
});
