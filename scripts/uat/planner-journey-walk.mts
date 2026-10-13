/* eslint-disable @typescript-eslint/ban-ts-comment -- see the next line. */
// @ts-nocheck -- an Admin SDK + HTTP harness run through tsx; it reads untyped Firestore documents. Not part of the app.
/**
 * The wedding planner walk (docs/planner-journey-plan.md, Phase 2): a planner
 * studio made through the real onboarding function with trade "planner"; a
 * month-of coordination wedding from inquiry to vendor credits; and a full
 * planning wedding whose vendor team starts at booking. Through StudioCue's
 * own command functions (HTTP, real ID tokens), its app routes (the couple's
 * portal, a vendor's confirm) and its schedulers (in-process), against the
 * Firebase emulator. Nothing is written by hand but the clock — dates moved
 * the way the calendar would move them — and the mock QuickBooks connection.
 *
 *   firebase emulators:start --project studiohub-dev          (another shell)
 *   next dev (live data mode, pointed at the same emulator)   (another shell)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     UAT_FUNCTIONS_ORIGIN=http://127.0.0.1:5001 UAT_APP_URL=http://localhost:3000 \
 *     npx tsx scripts/uat/planner-journey-walk.mts
 *
 * Every line prints PASS or FAIL with what was read back; the exit code is the
 * number of failures.
 */
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";

const REPO = process.cwd();
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Refusing to run without the emulator hosts.");
}
const projectId = process.env.GCLOUD_PROJECT ?? "studiohub-dev";
if (/prod/i.test(projectId)) throw new Error(`Refusing to run against project "${projectId}".`);
const FUNCTIONS = `${process.env.UAT_FUNCTIONS_ORIGIN ?? "http://127.0.0.1:5001"}/${projectId}/us-east4`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const APP = process.env.UAT_APP_URL ?? "http://localhost:3000";

const functionsRequire = createRequire(`${REPO}/functions/package.json`);
functionsRequire("firebase-admin/app").initializeApp({ projectId });
const auth = functionsRequire("firebase-admin/auth").getAuth();
const db = functionsRequire("firebase-admin/firestore").getFirestore();

// ── Reporting ───────────────────────────────────────────────────────────────
const results: Array<{ journey: string; step: string; ok: boolean; detail: string }> = [];
let journey = "setup";
function record(step: string, ok: boolean, detail: string) {
  results.push({ journey, step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${journey}] ${step} — ${detail}`);
  return ok;
}
async function attempt<T>(step: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    record(step, false, `threw: ${String((error as Error)?.message ?? error).slice(0, 300)}`);
    return null;
  }
}

// ── Accounts and commands ───────────────────────────────────────────────────
const run = Date.now().toString(36);
const PASSWORD = randomBytes(12).toString("base64url");
const tokens = new Map<string, string>();
async function account(email: string, displayName: string): Promise<string> {
  const existing = await auth.getUserByEmail(email).catch(() => null);
  if (existing) await auth.deleteUser(existing.uid);
  const user = await auth.createUser({ email, password: PASSWORD, emailVerified: true, displayName });
  return user.uid;
}
async function token(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const response = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!body.idToken) throw new Error(`sign-in failed for ${email}`);
  tokens.set(email, body.idToken);
  return body.idToken;
}
async function command(fn: string, type: string, tenantId: string, input: Record<string, unknown>, email: string) {
  const response = await fetch(`${FUNCTIONS}/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await token(email)}` },
    body: JSON.stringify({ type, tenantId, idempotencyKey: randomUUID(), input }),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(`${fn}/${type}: ${response.status} ${String(body.error ?? body.raw ?? "")}`);
  return body;
}
async function post(fn: string, payload: unknown, email?: string) {
  const response = await fetch(`${FUNCTIONS}/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(email ? { authorization: `Bearer ${await token(email)}` } : {}) },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(`${fn}: ${response.status} ${String(body.error ?? body.raw ?? "")}`);
  return body;
}
async function portal(type: string, body: Record<string, unknown>, email: string) {
  const response = await fetch(`${APP}/api/client/portal`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await token(email)}` },
    body: JSON.stringify({ type, idempotencyKey: randomUUID(), ...body }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`portal/${type}: ${response.status} ${String(result.error ?? result.code ?? "")}`);
  return result;
}
const data = async (path: string) => (await db.doc(path).get()).data() ?? null;
const query = async (collection: string, tenantId: string, where: Record<string, unknown> = {}) => {
  let q = db.collection(collection).where("tenantId", "==", tenantId);
  for (const [key, value] of Object.entries(where)) q = q.where(key, "==", value);
  return (await q.get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const tokenFrom = (url: unknown) => new URL(String(url), "http://x").searchParams.get("token") ?? "";
const waitFor = async <T,>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 20000): Promise<T> => {
  const until = Date.now() + ms;
  let value = await read();
  while (!ok(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    value = await read();
  }
  return value;
};

// ── In-process workers and schedulers (the emulator never fires schedules) ──
const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
const { sweepEventReminders } = await import(`${REPO}/functions/src/communications/event-reminders.ts`);
const { finalInvoiceScheduler } = await import(`${REPO}/functions/src/operations/invoice-scheduler.ts`);
const { finalDetailsScheduler } = await import(`${REPO}/functions/src/planning/final-details.ts`);
const { planningFormScheduler } = await import(`${REPO}/functions/src/planning/planning-form-scheduler.ts`);
const { PLANNER_STARTER_AGREEMENT, starterAgreementFor } = await import(`${REPO}/features/contracts/sample.ts`);
const { vendorArrivalLines, vendorTeamProgress, publishedTimelineVersion } = await import(`${REPO}/features/vendors/team.ts`);
const { projectJourney } = await import(`${REPO}/features/journey/steps.ts`);
const { clientAsks } = await import(`${REPO}/features/journey/burden.ts`);
const { projectProfile } = await import(`${REPO}/features/job-kinds/job-kinds.ts`);
const { examplePackagesFor } = await import(`${REPO}/features/job-kinds/example-packages.ts`);
const { vendorTeamStarts } = await import(`${REPO}/features/planning/planning-scope.ts`);
const { walkthroughState } = await import(`${REPO}/features/consultations/walkthrough.ts`);
const { handOutSummary, paymentsToHandOut } = await import(`${REPO}/features/vendors/hand-out.ts`);
const { loadReadinessEvidence } = await import(`${REPO}/functions/src/workflow/readiness-evidence-loader.ts`);
const { checkpointSatisfiedByEvidence } = await import(`${REPO}/functions/src/workflow/checkpoint-evidence.ts`);

const PHOTO_WORDS = /photo|gallery|album|\bshoot\b|\bshot\b/i;
const words = (text: string) => text.replace(/https?:\/\/\S+/g, "");

async function drain(collection: string, id: string) {
  await processJobDocument(collection, id).catch(() => undefined);
  for (let i = 0; i < 20; i += 1) {
    const status = String((await data(`${collection}/${id}`))?.status ?? "");
    if (!["queued", "processing", "retry_scheduled", "claimed"].includes(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return String((await data(`${collection}/${id}`))?.status ?? "");
}
async function drainAll(collection: string, tenantId: string) {
  for (const job of await query(collection, tenantId)) {
    if (["queued", "retry_scheduled"].includes(String(job.status))) await drain(collection, job.id);
  }
}
async function emails(tenantId: string, type: string, projectId?: string) {
  const jobs = (await query("emailJobs", tenantId, { type })).filter((job) => !projectId || job.projectId === projectId);
  const out = [];
  for (const job of jobs.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))) {
    await drain("emailJobs", job.id);
    const message = await data(`messages/${job.id}`);
    out.push({ job: (await data(`emailJobs/${job.id}`)) ?? job, subject: String(message?.subject ?? ""), text: String(message?.sentText ?? ""), recipient: String(message?.recipient ?? ""), id: job.id });
  }
  return out;
}
const email = async (tenantId: string, type: string, projectId?: string) => (await emails(tenantId, type, projectId)).at(-1) ?? null;

/** The job's journey from its records, as the job page reads them (components/projects/use-project-journey.ts). */
async function journeyOf(tenantId: string, id: string, today = day(0)) {
  const project = await data(`projects/${id}`);
  const [proposals, contracts, invoices, forms, schedules, team, shares, consultations] = await Promise.all(
    ["proposals", "contracts", "invoiceReferences", "questionnaireResponses", "schedules", "projectVendors", "scheduleShares", "consultations"].map((name) => query(name, tenantId, { projectId: id })),
  );
  const latest = [...schedules].sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0];
  const form = forms.find((row) => /Final details/.test(String(row.templateName ?? "")));
  return projectJourney({
    projectId: id,
    profile: projectProfile(project),
    trade: "planner",
    state: project.state,
    eventDate: project.eventDate,
    today,
    lead: { id: "lead", status: "converted", replied: true },
    hasConsultation: consultations.some((row) => (row.purpose ?? "consultation") === "consultation"),
    proposalStatus: proposals.at(-1)?.status ?? null,
    contractStatus: contracts.at(-1)?.status ?? null,
    retainerInvoiceStatus: invoices.find((row) => row.kind === "retainer")?.status ?? null,
    finalInvoiceStatus: invoices.find((row) => row.kind === "final")?.status ?? null,
    questionnaireStatus: form?.status ?? null,
    questionnaireHasAnswers: Boolean(form && Object.keys(form.answers ?? {}).length),
    scheduleStatus: latest?.status ?? null,
    scheduleHasUsableItems: Boolean(latest?.items?.length),
    crewAccepted: 0,
    crewRequired: 0,
    crewCascadeActive: false,
    coiStatus: null,
    insuranceRequired: project.insuranceRequired ?? "unknown",
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: ["REVIEW_REQUESTED", "CLOSED"].includes(project.state),
    finalCall: null,
    vendorTeam: vendorTeamProgress(team, shares, publishedTimelineVersion(schedules)),
    vendorTeamStarts: vendorTeamStarts(project),
    walkthrough: walkthroughState({ consultations, project, now: new Date().toISOString() }),
    handOut: handOutSummary(paymentsToHandOut(team, project.eventDate)),
  });
}
const stepLine = (journeyResult) => journeyResult.steps.map((step) => `${step.title}${step.status === "current" ? "*" : step.status === "complete" ? "✓" : ""}`).join(" › ");

// ═══════════════════════════ The studio ═════════════════════════════════════
const owner = `uat-planner-${run}@studiohub.test`;
await account(owner, "Claire Wren");
const onboarded = await post(
  "tenantOnboardingCommand",
  { businessName: "Wren & Co. Events", legalName: "Wren & Co. Events LLC", timezone: "America/New_York", currency: "USD", trade: "planner" },
  owner,
);
const tenantId = String(onboarded.tenantId);
await db.doc(`subscriptions/${tenantId}`).set({ status: "trialing", checkoutRequired: false, currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000).toISOString() }, { merge: true });
tokens.delete(owner);
{
  const tenant = await data(`tenants/${tenantId}`);
  record("a planner studio signs up through onboarding", tenant?.trade === "planner" && tenant?.subscriptionPlan === "vendor", `trade ${tenant?.trade}, plan ${tenant?.subscriptionPlan}`);
  const timeline = tenant?.planningTimeline ?? {};
  record(
    "its planning timeline: Final details three months out, automatically, locked two weeks out, no final call",
    timeline.formMonthsBefore === 3 && timeline.formSend === "auto" && timeline.lockDaysBefore === 14 && timeline.finalCall === false && timeline.formAtBooking === false,
    JSON.stringify({ months: timeline.formMonthsBefore, send: timeline.formSend, lock: timeline.lockDaysBefore, finalCall: timeline.finalCall }),
  );
  const forms = await query("questionnaireTemplates", tenantId);
  const finalDetails = forms.find((row) => row.recommendedId === "planner-final-details");
  record("seeded forms: Final details alone, with the vendor section", forms.length === 1 && Boolean(finalDetails) && timeline.formTemplateId === finalDetails?.id && JSON.stringify(finalDetails.sections).includes('"vendor-team"'), forms.map((row) => row.name).join(", "));
  const workflow = (await query("workflowTemplates", tenantId)).find((row) => row.eventTypeId === "wedding");
  record("five readiness checks on a wedding", workflow?.checkpointTemplates?.length === 5, (workflow?.checkpointTemplates ?? []).map((check) => check.name).join(", "));
  const inquiry = await data(`leadCaptureSettings/${tenantId}`);
  record(
    "the inquiry form asks the venue, the tier, the vendors and the wedding's budget",
    inquiry?.inquiryForm?.askBudget === true && (inquiry?.inquiryForm?.questions ?? []).map((q) => q.id).join() === "venue-booked,planning-tier,vendors-booked" && !inquiry?.inquiryEventForm,
    `budget ${inquiry?.inquiryForm?.askBudget}, questions ${(inquiry?.inquiryForm?.questions ?? []).map((q) => q.id).join(", ")}`,
  );
  record("the journey's budget: 6 asks", clientAsks("wedding", "planner").length === 6, clientAsks("wedding", "planner").map((ask) => ask.label).join("; "));
}

// Hours for the discovery call and the walkthrough, QuickBooks (mock), the agreement.
await command("bookingCommand", "setConsultationSettings", tenantId, {
  durationMinutes: 45, bufferMinutes: 15, mode: "open_default",
  windows: ["mon", "tue", "wed", "thu", "fri", "sat"].map((weekday) => ({ day: weekday, startMinute: 9 * 60, endMinute: 17 * 60 })),
  unavailableWindows: [], blockedDates: [], meetingFormats: ["in_person", "phone"], inPersonLocation: "At your venue",
}, owner).catch((error) => record("hours saved", false, String(error.message)));
await db.doc(`integrationConnections/qbo_${tenantId}`).set({
  id: `qbo_${tenantId}`, tenantId, provider: "quickbooks", capability: "invoicing", status: "connected", mockMode: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
const agreement = String(PLANNER_STARTER_AGREEMENT)
  .replace("[If you do, say from whom and how much.]", "")
  .replace("[your overtime rate]", "$75")
  .replace("[your travel area]", "30 miles")
  .replace("[your travel rate]", "$0.70 a mile")
  .replace("[Replace with your own cancellation and rescheduling terms.]", "The Client may cancel in writing; payments made to date are kept by the Planner.")
  .replace("[Replace with your own terms.]", "The Planner's liability is limited to the fees paid.");
await attempt("agreement saved from the planner starter", () =>
  command("bookingCommand", "saveAgreementTemplate", tenantId, { templateId: null, name: "Planning agreement", title: starterAgreementFor("planner").title, body: agreement, customFields: [], makeDefault: true }, owner),
);

// The extra assistant per person, offered on the packages; packages from the examples, with their tiers.
const assistant = await command("crmCommand", "saveAddOn", tenantId, {
  addOnId: null, name: "Additional assistant", description: "Another assistant coordinator on the day.", unitPriceCents: 45000, taxable: false, allowQuantity: true, unitLabel: "person", archived: false,
}, owner);
const assistantId = String(assistant.addOnId ?? assistant.id);
const examples = examplePackagesFor("planner", "wedding");
const packages: Record<string, string> = {};
for (const [example, price] of [[examples[0], 750000], [examples[2], 220000]] as const) {
  const created = await command("crmCommand", "createPackage", tenantId, {
    name: example.name, description: example.description, eventTypeId: "wedding", eventTypeLabel: "Wedding", paymentShape: "deposit_and_balance",
    planningScope: example.planningScope, basePriceCents: price, currency: "USD", retainerRule: { type: "percentage", basisPoints: 5000 },
    includedCoverageMinutes: example.coverageHours * 60, includedCoverage: [{ role: "coordinator", count: example.photographers }],
    includedDeliverables: example.deliverables.split(",").map((item) => item.trim()), includedTravelArea: "Within 30 miles",
    addOns: [], addOnIds: [assistantId], taxRateBasisPoints: 0, terms: "Subject to the completed studio agreement.", active: true, publicVisible: false, displayOrder: 0, internalNotes: null,
  }, owner);
  packages[example.planningScope] = String(created.packageId);
}
{
  const pkg = await data(`packages/${packages.coordination}`);
  record("packages from the examples keep their tier", pkg?.planningScope === "coordination" && (await data(`packages/${packages.full}`))?.planningScope === "full", `${pkg?.name}: ${pkg?.planningScope}`);
}

/** An inquiry from the website form, as the couple sends it. */
async function inquire(first: string, last: string, eventDate: string, tier: string, budget: string) {
  const tenant = await data(`tenants/${tenantId}`);
  const clientEmail = `uat-planner-client-${first.toLowerCase()}-${run}@studiohub.test`;
  const response = await fetch(`${FUNCTIONS}/publicLeadIntake`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-studiohub-client-ip": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({
      tenantSlug: tenant?.publicSlug, firstName: first, lastName: last, email: clientEmail, phone: "201-555-0142", eventType: "Wedding", eventTypeKey: "wedding",
      servicesRequested: ["other"], message: "We'd love help pulling it all together.", consent: true, eventDate, city: "Montclair, NJ", venue: "Hollow Oak Inn",
      estimatedGuestCount: 140, budgetRange: budget,
      customAnswers: { "venue-booked": "yes", "planning-tier": tier, "vendors-booked": "Florist and photographer so far" }, honeypot: "",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`publicLeadIntake: ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  const lead = await waitFor(() => data(`leads/${body.leadId}`), (value) => Boolean(value?.projectId));
  return { leadId: String(body.leadId), projectId: String(lead?.projectId ?? ""), clientEmail, lead };
}

/** The couple books a call or appointment from the studio's link. */
async function bookFromLink(projectId: string, purpose: string, pick = 0) {
  const project = await data(`projects/${projectId}`);
  await post("publicConsultationScheduling", { type: "create_link", tenantId, idempotencyKey: randomUUID(), input: { projectId, contactId: project.clientContactIds[0], mode: "in_person", purpose } }, owner);
  const invite = (await emails(tenantId, "consultation_invitation", projectId)).filter((row) => (row.job.purpose ?? "consultation") === purpose).at(-1);
  const linkToken = tokenFrom(invite?.job?.actionUrl);
  const slots = await post("publicConsultationScheduling", { type: "availability", idempotencyKey: randomUUID(), input: { token: linkToken } });
  const slot = (slots.slots ?? [])[pick];
  if (!slot) throw new Error(`no ${purpose} openings`);
  await post("publicConsultationScheduling", { type: "book", idempotencyKey: randomUUID(), input: { token: linkToken, startsAt: slot.startsAt } });
  return { invite, slot, durationMinutes: slots.durationMinutes };
}

/** Proposal → accepted → agreement signed → retainer paid → booked. */
async function bookToBooked(projectId: string, clientEmail: string, client: string, packageId: string, addOns: Array<{ addOnId: string; quantity: number }>) {
  const locked = await command("crmCommand", "selectPackage", tenantId, { projectId, packageId, selectedAddOns: addOns, mode: "replace", confirmReplace: false, discount: { type: "none" } }, owner);
  const draft = await command("proposalCommand", "create_draft", tenantId, {
    projectId, expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(), notes: null, termsSummary: "Subject to the signed agreement.", retainerDueDate: null, balanceDueDate: null,
  }, owner);
  const proposalId = String(draft.proposalId);
  await command("proposalCommand", "submit_for_approval", tenantId, { proposalId }, owner);
  await command("proposalCommand", "approve", tenantId, { proposalId }, owner);
  for (const job of (await query("pdfJobs", tenantId)).filter((job) => job.proposalId === proposalId)) await drain("pdfJobs", job.id);
  await command("proposalCommand", "send", tenantId, { proposalId }, owner);
  const sent = await email(tenantId, "proposal_sent", projectId);
  await account(clientEmail, client);
  await post("clientInvitationCommand", { type: "accept", idempotencyKey: randomUUID(), input: { token: tokenFrom(sent?.job?.actionUrl) } }, clientEmail);
  await portal("decide_proposal", { tenantId, projectId, proposalId, decision: "accepted", reason: null }, clientEmail);
  await waitFor(() => data(`contractDrafts/${projectId}`), (value) => Boolean(value?.documentHash));
  await command("bookingCommand", "prepareContract", tenantId, { projectId, proposalId, overrides: {} }, owner).catch(() => undefined);
  const prepared = await data(`contractDrafts/${projectId}`);
  await command("bookingCommand", "sendContract", tenantId, { projectId, documentHash: prepared?.documentHash, studioSignerName: "Claire Wren", consent: true }, owner);
  const contract = (await query("contracts", tenantId, { projectId }))[0];
  await portal("sign_contract", {
    tenantId, projectId, contractId: contract.id, documentHash: contract.documentHash, typedName: client, consent: true, consentVersion: "esign-consent-v2",
    billingAddress: { line1: "14 Mill Lane", line2: null, city: "Montclair", region: "NJ", postalCode: "07042", country: "US" },
  }, clientEmail);
  await waitFor(async () => (await query("invoiceReferences", tenantId, { projectId })).find((invoice) => invoice.kind === "retainer"), Boolean);
  await drainAll("providerJobs", tenantId);
  await command("bookingCommand", "recordRetainerPayment", tenantId, { projectId, packageSnapshotId: String(locked.packageSnapshotId), paidAt: day(0), method: "card", reference: null, attestation: true }, owner);
  const booked = await waitFor(() => data(`projects/${projectId}`), (value) => value?.state === "BOOKED", 30000);
  await drainAll("providerJobs", tenantId);
  return { proposalId, packageSnapshotId: String(locked.packageSnapshotId), contract, booked, sent };
}

// ═══════════════════════════ A month-of wedding ═════════════════════════════
journey = "month-of";
let monthOf: string | null = null;
{
  const inquiry = await attempt("inquiry", () => inquire("Maya", "Brooks", day(200), "Month-of coordination", "About $35,000"));
  if (inquiry) {
    const { projectId, clientEmail } = inquiry;
    monthOf = projectId;
    let project = await data(`projects/${projectId}`);
    record("a job on arrival, with the wedding's budget", project?.state === "LEAD" && project?.budgetCents === 3_500_000 && project?.budgetSource === "inquiry", `state ${project?.state}, budget ${project?.budgetCents}`);
    record("the inquiry's own answers are kept", /planning-tier/.test(JSON.stringify(inquiry.lead?.customAnswers ?? [])), (inquiry.lead?.customAnswers ?? []).map((row) => `${row.questionId}=${row.answer}`).join(", "));
    const lead = await journeyOf(tenantId, projectId);
    record("the journey before the call: the discovery call is the move", lead.current?.key === "consultation", stepLine(lead));

    const call = await attempt("discovery call booked from the link", () => bookFromLink(projectId, "consultation"));
    project = await data(`projects/${projectId}`);
    record("the discovery call moves the job on", project?.state === "CONSULTATION", `state ${project?.state}; invite "${call?.invite?.subject ?? "none"}"`);

    const booked = await attempt("proposal (month-of + an extra assistant) → accepted → signed → retainer → booked", () =>
      bookToBooked(projectId, clientEmail, "Maya Brooks", packages.coordination, [{ addOnId: assistantId, quantity: 1 }]),
    );
    if (booked) {
      project = await data(`projects/${projectId}`);
      const snapshot = await data(`packageSnapshots/${booked.packageSnapshotId}`);
      record("booked, month-of: the tier is on the job and its snapshot", project?.state === "BOOKED" && project?.planningScope === "coordination" && snapshot?.planningScope === "coordination", `state ${project?.state}, job ${project?.planningScope}, snapshot ${snapshot?.planningScope}, total ${snapshot?.totalCents}`);
      record("the extra assistant priced per person", snapshot?.addOns?.[0]?.unitLabel === "person" && snapshot?.totalCents === 265000, `${snapshot?.addOns?.[0]?.quantity} ${snapshot?.addOns?.[0]?.unitLabel} × ${snapshot?.addOns?.[0]?.unitPriceCents}`);
      const row = (booked.contract?.document?.blocks ?? []).find((block) => block?.type === "payment_schedule")?.rows?.[0];
      record("the agreement's schedule says Retainer", row?.label === "Retainer", `row ${row?.label}`);
      record("the proposal email never says photography", !PHOTO_WORDS.test(words(booked.sent?.text ?? "")), booked.sent?.subject ?? "none");
      const forms = await query("questionnaireResponses", tenantId, { projectId });
      record("no Final details at booking for month-of", forms.length === 0, `${forms.length} forms`);
      const journeyBooked = await journeyOf(tenantId, projectId);
      const team = journeyBooked.steps.find((step) => step.key === "vendor_team");
      record("the vendor team waits for their intake", team?.status === "upcoming" && /eight weeks out/.test(team.detail), `${team?.status}: ${team?.detail}`);
      record("eleven steps", journeyBooked.steps.length === 11, stepLine(journeyBooked));

      // Eight weeks out: the Final details go.
      await db.doc(`projects/${projectId}`).set({ eventDate: day(60) }, { merge: true });
      await planningFormScheduler.run({});
      record("nothing at nine weeks", (await query("questionnaireResponses", tenantId, { projectId })).length === 0, "day 60");
      await db.doc(`projects/${projectId}`).set({ eventDate: day(56) }, { merge: true });
      await planningFormScheduler.run({});
      const finalForms = await query("questionnaireResponses", tenantId, { projectId });
      const finalDetails = finalForms.find((form) => /Final details/.test(String(form.templateName ?? "")));
      record("the Final details go out eight weeks before", Boolean(finalDetails), finalForms.map((form) => `${form.templateName}:${form.status}`).join(", ") || "none");
      const requestEmail = await email(tenantId, "questionnaire_request", projectId);
      record("its email never says photography", requestEmail !== null && !PHOTO_WORDS.test(words(requestEmail.text)), requestEmail?.subject ?? "none");

      if (finalDetails) {
        const section = [
          "Florist — Petal & Stem — Rosa Diaz, rosa@petalandstem.example, 908 555 0117 — arriving 1:30 PM",
          "Photographer — Hart Light Studio — hello@hartlight.example — arriving 12:00 PM",
          "DJ — Spin Theory DJs — Jay, jay@spintheory.example — load-in 3pm",
        ].join("\n");
        await attempt("the couple sends the Final details back with three vendors", () =>
          command("planningCommand", "saveQuestionnaire", tenantId, {
            responseId: finalDetails.id, projectId, submit: true,
            answers: {
              "getting-ready": "Maya: Hollow Oak Inn, bridal suite. Theo: the Grove cottage.", "ceremony-location": "The Orchard Lawn, Hollow Oak Inn", "ceremony-time": "16:00",
              "reception-location": "The Barn, Hollow Oak Inn", "reception-time": "17:30", "key-people": "Ana Brooks (mom) 973 555 0101\nJess Hart (MOH) 973 555 0102",
              "rehearsal-date-time": "Friday at 5 PM", "guest-count": "142", "vendor-team": section,
            },
          }, clientEmail),
        );
        const team = await query("projectVendors", tenantId, { projectId });
        record("their three vendors join the vendor team, booked", team.length === 3 && team.every((entry) => entry.status === "booked"), team.map((entry) => `${entry.company} (${entry.category}, ${entry.arrivalTime ?? "-"})`).join(", "));
        const journeyIntake = await journeyOf(tenantId, projectId, day(0));
        const teamStep = journeyIntake.steps.find((step) => step.key === "vendor_team");
        record("vendor team complete", teamStep?.status === "complete", `${teamStep?.status}: ${teamStep?.detail}`);
        // Readiness reads its checks from the records (the reconciler never
        // writes a checkpoint's status) and scores the job from them.
        const checks = await query("checkpoints", tenantId, { projectId });
        const evidence = await loadReadinessEvidence(db, tenantId, projectId);
        const satisfied = checks.filter((row) => checkpointSatisfiedByEvidence(row, evidence)).map((row) => row.templateKey);
        const scored = await waitFor(() => data(`projects/${projectId}`), (value) => Number(value?.readinessScore ?? 0) > 0);
        record(
          "readiness counts 'Vendor team complete' from the records",
          evidence.vendorTeamComplete === true && satisfied.includes("vendor-team-complete") && Number(scored?.readinessScore ?? 0) > 0,
          `satisfied: ${satisfied.join(", ")}; score ${scored?.readinessScore}`,
        );

        // The walkthrough, invited from the job.
        await db.doc(`projects/${projectId}`).set({ eventDate: day(40) }, { merge: true });
        const walk = await attempt("walkthrough booked from the link", () => bookFromLink(projectId, "walkthrough"));
        record("the walkthrough invitation says walkthrough", /venue walkthrough/i.test(walk?.invite?.subject ?? "") && !/consultation|photograph/i.test(words(walk?.invite?.text ?? "")), walk?.invite?.subject ?? "none");
        record("each opening is the walkthrough's hour", walk?.durationMinutes === 60, `${walk?.durationMinutes} minutes`);
        project = await data(`projects/${projectId}`);
        const walkRow = (await query("consultations", tenantId, { projectId })).find((row) => row.purpose === "walkthrough");
        record("booked as a walkthrough; the job stays where it was", Boolean(walkRow) && Boolean(project?.walkthroughBookedAt) && project?.state !== "CONSULTATION", `purpose ${walkRow?.purpose}, job ${project?.state}`);

        // The master timeline with every vendor's arrival, published, sent to every vendor.
        const isoAt = (clock: string) => new Date(`${day(40)}T${clock}:00-04:00`).toISOString();
        const base = [["Ceremony", "16:00", "16:30"], ["Cocktail hour", "16:30", "17:30"], ["Reception", "17:30", "22:00"]].map(([title, start, end], index) => ({
          id: `line-${index}`, startAt: isoAt(start), endAt: isoAt(end), title, description: "", location: "Hollow Oak Inn", address: null, travelMinutes: 0, crewIds: [],
          photographerIds: [], participants: [], vendorContactIds: [], equipment: [], notes: null, visibility: "shared", blockingIssues: [], sourceReferences: [],
        }));
        const arrivals = vendorArrivalLines(base, await query("projectVendors", tenantId, { projectId }), { eventDate: day(40), timeZone: "America/New_York" });
        record("vendor arrivals drawn from the team", arrivals.added === 3, arrivals.items.map((item) => item.title).join(" | "));
        await attempt("master timeline published", () => command("planningCommand", "publishSchedule", tenantId, { projectId, timezone: "America/New_York", coverageMinutes: 600, items: arrivals.items }, owner));
        const sendResult = await attempt("sent to every vendor in one press", () => command("planningCommand", "sendTimelineToVendorTeam", tenantId, { projectId, message: "" }, owner));
        const vendorMails = await emails(tenantId, "vendor_timeline", projectId);
        record("three vendor emails, each their own link", vendorMails.length === 3 && new Set(vendorMails.map((mail) => mail.recipient)).size === 3, vendorMails.map((mail) => `${mail.recipient}: ${mail.subject}`).join(" | ") || JSON.stringify(sendResult));
        const florist = vendorMails.find((mail) => /petalandstem/.test(mail.recipient));
        const shareToken = String(florist?.job?.shareUrl ?? "").split("/share/")[1] ?? "";
        const form = new FormData();
        form.set("token", shareToken);
        const ack = await fetch(`${APP}/api/share-ack`, { method: "POST", body: form, redirect: "manual" }).catch((error) => ({ status: String(error) }));
        const journeyConfirmed = await journeyOf(tenantId, projectId, day(0));
        const confirmedStep = journeyConfirmed.steps.find((step) => step.key === "vendors_confirmed");
        record("one vendor confirms: '1 of 3 confirmed'", /^1 of 3 confirmed/.test(confirmedStep?.detail ?? ""), `ack ${ack.status}; ${confirmedStep?.status}: ${confirmedStep?.detail}`);

        // The day before: balances and tips on the team, the assistants' reminder.
        const owed: Record<string, [number, number]> = { "Petal & Stem": [120000, 10000], "Hart Light Studio": [0, 15000], "Spin Theory DJs": [85000, 15000] };
        for (const entry of await query("projectVendors", tenantId, { projectId })) {
          const [balanceDueCents, tipCents] = owed[String(entry.company)] ?? [null, null];
          await command("planningCommand", "updateVendorTeamEntry", tenantId, {
            projectId, entryId: entry.entryId, vendorId: entry.vendorId, newVendor: null, vendorDetails: null, category: entry.category, roleLabel: entry.roleLabel ?? null,
            status: "booked", arrivalTime: entry.arrivalTime ?? null, loadInTime: entry.loadInTime ?? null, strikeTime: null, contractReceived: true, coiReceived: false,
            costCents: null, balanceDueCents, balanceDueDate: null, tipCents, notes: null,
          }, owner);
        }
        const crew = await attempt("an assistant coordinator", () =>
          command("crewCommand", "createCrewProfile", tenantId, {
            name: "Jo Park", email: `uat-planner-crew-${run}@studiohub.test`, phone: null, specialties: ["weddings"], trades: ["coordinator"], serviceAreas: ["NJ"], travelRadiusMiles: 30, rateType: "event", rateCents: 30000, currency: "USD",
          }, owner),
        );
        const offer = crew && await attempt("offered the day", () =>
          command("crewCommand", "inviteAssignment", tenantId, {
            projectId, crewProfileId: String(crew.crewProfileId ?? crew.id), userId: null, role: "Assistant coordinator", compensationCents: 30000, compensationType: "event", currency: "USD", compensationVisibleToCrew: true,
            arrivalAt: new Date(`${day(1)}T11:00:00-04:00`).toISOString(), departureAt: new Date(`${day(1)}T23:00:00-04:00`).toISOString(),
            locations: [{ name: "Hollow Oak Inn", address: null }], responsibilities: ["Vendor check-in"], scheduleItemIds: [], currentScheduleId: null, currentScheduleVersion: 0, requirements: [],
          }, owner),
        );
        const crewInvite = await email(tenantId, "crew_invitation", projectId);
        if (offer && crewInvite) {
          const crewEmail = `uat-planner-crew-${run}@studiohub.test`;
          await account(crewEmail, "Jo Park");
          await attempt("Jo accepts", () => post("crewInvitationCommand", { token: String(crewInvite.job?.inviteToken ?? tokenFrom(crewInvite.job?.actionUrl)), idempotencyKey: randomUUID() }, crewEmail));
          const assignmentId = String(offer.assignmentId ?? offer.id ?? crewInvite.job?.assignmentId ?? "");
          await attempt("Jo takes the job", () => command("crewCommand", "respondAssignment", tenantId, { projectId, assignmentId, decision: "accepted", reason: "" }, crewEmail));
        }
        await db.doc(`projects/${projectId}`).set({ eventDate: day(1) }, { merge: true });
        await sweepEventReminders(db, new Date());
        const reminder = await email(tenantId, "crew_reminder", projectId);
        record(
          "the assistants' reminder: the emergency kit, and the envelopes in the order the vendors arrive",
          reminder !== null && /Emergency kit — before you leave/.test(reminder.text) && /Payments and tips to hand out — Hart Light Studio \(Photographer\): tip \$150; Petal & Stem \(Florist\): balance \$1,200 and tip \$100; Spin Theory DJs \(DJ\): balance \$850 and tip \$150/.test(reminder.text),
          reminder ? (reminder.text.match(/Payments and tips to hand out[^\n]*/)?.[0] ?? reminder.subject) : "no email",
        );
        const dayBefore = await journeyOf(tenantId, projectId, day(0));
        const dayStep = dayBefore.steps.find((step) => step.key === "event_day");
        record("the day's step: the kit and the envelopes, the contact sheet behind it", /3 envelopes to hand out, \$2,450/.test(dayStep?.detail ?? "") && dayStep?.record?.href.endsWith("/vendors/print"), `${dayStep?.title}: ${dayStep?.detail} → ${dayStep?.record?.href}`);
        record("no lock sign-off: the walkthrough settled the details", (await finalDetailsScheduler.run({}), !(await data(`detailSignoffs/${tenantId}_${projectId}`))), "detailSignoffs none");

        // The day, then the review: nothing to deliver.
        let current = await data(`projects/${projectId}`);
        if (current.state === "BOOKED") {
          await command("crmCommand", "transitionProject", tenantId, { projectId, expectedVersion: current.stateVersion, targetState: "PLANNING", reason: "Planning.", notifyClient: false, clientMessage: null }, owner).catch(() => undefined);
          current = await data(`projects/${projectId}`);
        }
        await db.doc(`projects/${projectId}`).set({ eventDate: day(-1) }, { merge: true });
        current = await data(`projects/${projectId}`);
        await attempt("we ran it", () => command("crmCommand", "transitionProject", tenantId, { projectId, expectedVersion: current.stateVersion, targetState: "EVENT_COMPLETE", reason: "The wedding happened.", notifyClient: false, clientMessage: null }, owner));
        current = await data(`projects/${projectId}`);
        const refused = await command("crmCommand", "transitionProject", tenantId, { projectId, expectedVersion: current.stateVersion, targetState: "POST_PRODUCTION", reason: "x", notifyClient: false, clientMessage: null }, owner).then(() => "allowed").catch((error) => String(error.message));
        record("post-production is refused: a planner delivers nothing", refused !== "allowed", refused.slice(0, 120));
        current = await data(`projects/${projectId}`);
        await attempt("to the review", () => command("crmCommand", "transitionProject", tenantId, { projectId, expectedVersion: current.stateVersion, targetState: "REVIEW_REQUESTED", reason: "Asking for a review.", notifyClient: false, clientMessage: null }, owner));
        current = await data(`projects/${projectId}`);
        record("the day, then the review", current?.state === "REVIEW_REQUESTED", `state ${current?.state}`);

        // Vendor credits, once.
        const credits = await attempt("send vendor credits", () => command("planningCommand", "sendVendorCredits", tenantId, { projectId }, owner));
        const again = await attempt("press it again", () => command("planningCommand", "sendVendorCredits", tenantId, { projectId }, owner));
        const creditMail = await email(tenantId, "vendor_credits", projectId);
        record(
          "the couple gets the vendor credits, the studio first, once",
          credits?.count === 4 && again?.alreadySent === true && /Planning: Wren & Co\. Events/.test(creditMail?.text ?? "") && /Florals: Petal & Stem/.test(creditMail?.text ?? "") && creditMail?.recipient === clientEmail,
          `${creditMail?.subject} → ${creditMail?.recipient}; ${(creditMail?.text ?? "").match(/Planning:[^\n]*/)?.[0] ?? ""}`,
        );
        const end = await journeyOf(tenantId, projectId, day(0));
        record("the journey at the end", !end.steps.some((step) => step.key === "delivery") && end.steps.length <= 12, stepLine(end));
      }
    }
  }
}

// ═══════════════════════════ A full-planning wedding ════════════════════════
journey = "full planning";
let fullPlanning: string | null = null;
{
  const inquiry = await attempt("inquiry", () => inquire("Priya", "Shah", day(300), "Full planning", "About $50,000"));
  if (inquiry) {
    const { projectId, clientEmail } = inquiry;
    fullPlanning = projectId;
    await attempt("discovery call", () => bookFromLink(projectId, "consultation", 1));
    const booked = await attempt("booked on Full planning", () => bookToBooked(projectId, clientEmail, "Priya Shah", packages.full, []));
    if (booked) {
      const project = await data(`projects/${projectId}`);
      record("the tier is full", project?.planningScope === "full", `${project?.planningScope}, budget ${project?.budgetCents}`);
      const atBooking = await journeyOf(tenantId, projectId);
      record("the vendor team is the move from booking", atBooking.current?.key === "vendor_team", stepLine(atBooking));
      await attempt("a venue and a florist still needed", async () => {
        await command("planningCommand", "addVendorTeamEntry", tenantId, { projectId, vendorId: null, newVendor: { company: "Hollow Oak Inn", contactName: "Dana", email: "events@hollowoak.example", phone: null }, category: "venue", status: "booked" }, owner);
        await command("planningCommand", "addVendorTeamEntry", tenantId, { projectId, vendorId: null, newVendor: null, category: "florist", status: "needed" }, owner);
      });
      const withTeam = await journeyOf(tenantId, projectId);
      record("'1 of 2 booked · 1 still to find'", /1 of 2 booked · 1 still to find/.test(withTeam.steps.find((step) => step.key === "vendor_team")?.detail ?? ""), stepLine(withTeam));
      const forms = await query("questionnaireResponses", tenantId, { projectId });
      record("the Final details wait for three months out", forms.length === 0, `${forms.length} forms now`);
      await db.doc(`projects/${projectId}`).set({ eventDate: day(85) }, { merge: true });
      await planningFormScheduler.run({});
      const sent = await query("questionnaireResponses", tenantId, { projectId });
      const finalDetails = sent.find((form) => /Final details/.test(String(form.templateName ?? "")));
      record("three months out, the Final details go, the vendor section filled in from the team", Boolean(finalDetails) && /Venue — Hollow Oak Inn/.test(String(finalDetails?.answers?.["vendor-team"] ?? "")), String(finalDetails?.answers?.["vendor-team"] ?? "no prefill"));
      await finalInvoiceScheduler.run({});
      const noBill = await data(`invoiceReferences/final_${projectId}`);
      await db.doc(`projects/${projectId}`).set({ eventDate: day(44) }, { merge: true });
      await finalInvoiceScheduler.run({});
      const bill = await data(`invoiceReferences/final_${projectId}`);
      record("the balance is billed 44 days out, due 30 days before", !noBill && Boolean(bill) && String(bill?.dueDate ?? "").slice(0, 10) === day(14), `before: ${noBill ? "billed" : "none"}; at 44: due ${bill?.dueDate ?? "none"}`);
    }
  }
}

const failures = results.filter((row) => !row.ok);
console.log(`\n${results.length - failures.length} passed, ${failures.length} failed. Tenant ${tenantId}; month-of ${monthOf}; full ${fullPlanning}; owner ${owner}`);
console.log(`WALK_OWNER=${owner} WALK_PASSWORD=${PASSWORD} WALK_TENANT=${tenantId} WALK_MONTHOF=${monthOf} WALK_FULL=${fullPlanning}`);
process.exit(failures.length);
