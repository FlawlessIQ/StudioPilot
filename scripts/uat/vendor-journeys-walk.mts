/* eslint-disable @typescript-eslint/ban-ts-comment -- see the next line. */
// @ts-nocheck -- an Admin SDK + HTTP harness run through tsx; it reads untyped Firestore documents. Not part of the app.
/**
 * The vendor journeys walk (docs/vendor-journeys-plan.md; the end-to-end UAT
 * plan's J2–J4): a DJ, a makeup artist and a hair stylist each take one
 * booking from inquiry to review, through StudioCue's own command functions
 * (HTTP, with real ID tokens) and its schedulers (in-process), against the
 * Firebase emulator. Nothing between the steps is written by hand except the
 * clock: dates are moved the way the calendar would move them.
 *
 *   firebase emulators:start --project studiohub-dev   (in another shell)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     npx tsx scripts/uat/vendor-journeys-walk.mts
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
const FUNCTIONS = `http://127.0.0.1:5001/${projectId}/us-east4`;

const functionsRequire = createRequire(`${REPO}/functions/package.json`);
functionsRequire("firebase-admin/app").initializeApp({ projectId });
const auth = functionsRequire("firebase-admin/auth").getAuth();
const db = functionsRequire("firebase-admin/firestore").getFirestore();

// ── Reporting ───────────────────────────────────────────────────────────────
const results: Array<{ journey: string; step: string; ok: boolean; detail: string }> = [];
let journey = "setup";
export function record(step: string, ok: boolean, detail: string) {
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
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!body.idToken) throw new Error(`sign-in failed for ${email}`);
  tokens.set(email, body.idToken);
  return body.idToken;
}
export async function command(
  fn: string,
  type: string,
  tenantId: string,
  input: Record<string, unknown>,
  email: string,
): Promise<Record<string, unknown>> {
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
async function post(fn: string, payload: unknown, email?: string): Promise<Record<string, unknown>> {
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
const data = async (path: string) => (await db.doc(path).get()).data() ?? null;
const query = async (collection: string, tenantId: string, where: Record<string, unknown> = {}) => {
  let q = db.collection(collection).where("tenantId", "==", tenantId);
  for (const [key, value] of Object.entries(where)) q = q.where(key, "==", value);
  return (await q.get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// ── Studios ─────────────────────────────────────────────────────────────────
type Studio = { trade: "dj" | "makeup" | "hair"; name: string; owner: string; tenantId: string };
async function onboard(trade: Studio["trade"], name: string): Promise<Studio> {
  const owner = `uat-${trade}-${run}@studiohub.test`;
  await account(owner, `${name} owner`);
  const result = await post(
    "tenantOnboardingCommand",
    { businessName: name, legalName: `${name} LLC`, timezone: "America/New_York", currency: "USD", trade },
    owner,
  );
  const tenantId = String(result.tenantId);
  // Checkout is Stripe's in production; here the studio starts its trial as checkout would leave it.
  await db.doc(`subscriptions/${tenantId}`).set(
    { status: "trialing", checkoutRequired: false, currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000).toISOString() },
    { merge: true },
  );
  tokens.delete(owner);
  return { trade, name, owner, tenantId };
}

const studios = {
  dj: await onboard("dj", "Spin Theory DJs"),
  makeup: await onboard("makeup", "Glow by Ana"),
  hair: await onboard("hair", "Jess Styles Bridal"),
};
for (const studio of Object.values(studios)) {
  const tenant = await data(`tenants/${studio.tenantId}`);
  record(`${studio.trade} studio onboarded`, tenant?.trade === studio.trade, `${studio.name}: trade ${tenant?.trade}, plan ${tenant?.subscriptionPlan}`);
}

// ── In-process workers and schedulers (the emulator never fires schedules) ──
const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
const { sweepEventReminders } = await import(`${REPO}/functions/src/communications/event-reminders.ts`);
const { lifecycleMessageScheduler } = await import(`${REPO}/functions/src/communications/lifecycle-scheduler.ts`);
const { finalInvoiceScheduler } = await import(`${REPO}/functions/src/operations/invoice-scheduler.ts`);
const { finalDetailsScheduler } = await import(`${REPO}/functions/src/planning/final-details.ts`);
const { chairDayPlan, planChairs } = await import(`${REPO}/features/schedules/chair-plan.ts`);
const { parsePartyList } = await import(`${REPO}/features/schedules/party-list.ts`);
const { BEAUTY_STARTER_AGREEMENT, starterAgreementFor } = await import(`${REPO}/features/contracts/sample.ts`);

const APP = process.env.UAT_APP_URL ?? "http://localhost:3000";
const PHOTO_WORDS = /photo|gallery|album|\bshoot\b|\bshot\b/i;
/** An email's words without its links: "/schedule/consultation?token=" is an address, not a word the client reads. */
const words = (text: string) => text.replace(/https?:\/\/\S+/g, "");

/** Drain a job the way the worker would, and wait for its status to settle. */
async function drain(collection: string, id: string) {
  await processJobDocument(collection, id).catch(() => undefined);
  for (let i = 0; i < 20; i += 1) {
    const status = String((await data(`${collection}/${id}`))?.status ?? "");
    if (!["queued", "processing", "retry_scheduled", "claimed"].includes(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return String((await data(`${collection}/${id}`))?.status ?? "");
}
/** Every queued job of a collection for a tenant, drained. */
async function drainAll(collection: string, tenantId: string) {
  for (const job of await query(collection, tenantId)) {
    if (["queued", "retry_scheduled"].includes(String(job.status))) await drain(collection, job.id);
  }
}
/** The email of a type on a job, sent through the mock worker, as the recipient got it. */
async function email(tenantId: string, type: string, projectId?: string) {
  const jobs = (await query("emailJobs", tenantId, { type })).filter((job) => !projectId || job.projectId === projectId);
  const job = jobs.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0];
  if (!job) return null;
  await drain("emailJobs", job.id);
  const message = await data(`messages/${job.id}`);
  return { job: (await data(`emailJobs/${job.id}`)) ?? job, subject: String(message?.subject ?? ""), text: String(message?.sentText ?? ""), recipient: String(message?.recipient ?? ""), id: job.id };
}
const waitFor = async <T,>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 20000): Promise<T> => {
  const until = Date.now() + ms;
  let value = await read();
  while (!ok(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    value = await read();
  }
  return value;
};
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
const tokenFrom = (url: unknown) => new URL(String(url), "http://x").searchParams.get("token") ?? "";

// ── The booking every trade shares, inquiry to booked ─────────────────────

async function studioReady(studio: Studio, agreementBody: string) {
  const tenant = await data(`tenants/${studio.tenantId}`);
  // Hours clients can book (consultation, trial, final call), Monday–Saturday 9–5.
  await command("bookingCommand", "setConsultationSettings", studio.tenantId, {
    durationMinutes: 60, bufferMinutes: 15, mode: "open_default",
    windows: WEEKDAYS.map((day) => ({ day, startMinute: 9 * 60, endMinute: 17 * 60 })),
    unavailableWindows: [], blockedDates: [], meetingFormats: ["in_person", "phone"], inPersonLocation: "The studio, 12 Main St",
  }, studio.owner).catch(async (error) => {
    // The window shape is the studio settings screen's; fall back to its stored form if the command refuses ours.
    record("consultation hours saved", false, String(error.message));
  });
  // QuickBooks connected (mock), as a studio that invoices would be: the retainer and final bill need a customer.
  await db.doc(`integrationConnections/qbo_${studio.tenantId}`).set({
    id: `qbo_${studio.tenantId}`, tenantId: studio.tenantId, provider: "quickbooks", capability: "invoicing", status: "connected", mockMode: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  // The studio's agreement, with its own wording in place of every placeholder.
  await db.doc(`tenants/${studio.tenantId}`).set({ legalName: `${studio.name} LLC` }, { merge: true });
  const saved = await command("bookingCommand", "saveAgreementTemplate", studio.tenantId, {
    templateId: null, name: "Wedding agreement", title: starterAgreementFor(studio.trade).title, body: agreementBody, customFields: [], makeDefault: true,
  }, studio.owner);
  record("agreement saved from the trade's starter", Boolean(saved.templateId ?? saved.id ?? saved), `${starterAgreementFor(studio.trade).title}; tenant slug ${tenant?.publicSlug}`);
  return tenant;
}

async function inquire(studio: Studio, input: { first: string; last: string; eventDate: string; answers: Record<string, string>; eventTypeKey?: string; message: string }) {
  const tenant = await data(`tenants/${studio.tenantId}`);
  const clientEmail = `uat-${studio.trade}-client-${run}@studiohub.test`;
  const response = await fetch(`${FUNCTIONS}/publicLeadIntake`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-studiohub-client-ip": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({
      tenantSlug: tenant?.publicSlug, firstName: input.first, lastName: input.last, email: clientEmail, phone: "201-555-0142",
      eventType: "Wedding", eventTypeKey: input.eventTypeKey ?? "wedding", servicesRequested: ["other"], message: input.message, consent: true,
      eventDate: input.eventDate, city: "Montclair, NJ", venue: "Hollow Oak Inn", customAnswers: input.answers, honeypot: "",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`publicLeadIntake: ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  const leadId = String(body.leadId);
  const lead = await waitFor(() => data(`leads/${leadId}`), (value) => Boolean(value?.projectId));
  return { leadId, projectId: String(lead?.projectId ?? ""), clientEmail, lead };
}
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat"];

/** The studio's beauty agreement with every placeholder replaced by real wording. */
const beautyAgreement = String(BEAUTY_STARTER_AGREEMENT)
  .replace(/\[Replace with your booking minimum[^\]]*\]/, "A minimum of four people applies. After the final headcount, people can be added but not taken off.")
  .replace(/\[Replace with what you need on the day[^\]]*\]/, "Please provide a table and chair near a window and two outlets. Starts before 7:00 AM add $75.")
  .replace(/\[Replace with your trial terms[^\]]*\]/, "The trial is $150 and comes off the balance.")
  .replace(/\[Replace with your terms on allergies[^\]]*\]/, "The Client tells the Studio about any allergies before the day.")
  .replace(/\[Replace with your cancellation terms[^\]]*\]/, "The retainer is non-refundable. Anyone booked who does not sit is charged in full.")
  .replace(/\[Replace with your own terms\.\]/, "The Studio's liability is limited to the fees paid.");

/** Quote → accepted → agreement signed → retainer paid → booked, through the real commands. */
async function bookToBooked(studio: Studio, input: { projectId: string; clientEmail: string; client: string; packageId: string; addOns: Array<{ addOnId: string; quantity: number }> }) {
  const { projectId, clientEmail } = input;
  const locked = await command("crmCommand", "selectPackage", studio.tenantId, {
    projectId, packageId: input.packageId, selectedAddOns: input.addOns, mode: "replace", confirmReplace: false, discount: { type: "none" },
  }, studio.owner);
  const packageSnapshotId = String(locked.packageSnapshotId);
  const draft = await command("proposalCommand", "create_draft", studio.tenantId, {
    projectId, expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(), notes: null,
    termsSummary: "Subject to the signed agreement.", retainerDueDate: null, balanceDueDate: null,
  }, studio.owner);
  const proposalId = String(draft.proposalId);
  await command("proposalCommand", "submit_for_approval", studio.tenantId, { proposalId }, studio.owner);
  await command("proposalCommand", "approve", studio.tenantId, { proposalId }, studio.owner);
  // No PDF service here: the PDF job fails once, which is what lets the send go.
  for (const job of (await query("pdfJobs", studio.tenantId)).filter((job) => job.proposalId === proposalId)) await drain("pdfJobs", job.id);
  await command("proposalCommand", "send", studio.tenantId, { proposalId }, studio.owner);
  // The client gets in from the email's invitation, then accepts in the portal.
  const sent = await email(studio.tenantId, "proposal_sent", projectId);
  const inviteToken = tokenFrom(sent?.job?.actionUrl ?? sent?.job?.values?.actionUrl);
  await account(clientEmail, input.client);
  await post("clientInvitationCommand", { type: "accept", idempotencyKey: randomUUID(), input: { token: inviteToken } }, clientEmail);
  await portal("decide_proposal", { tenantId: studio.tenantId, projectId, proposalId, decision: "accepted", reason: null }, clientEmail);
  const drafted = await waitFor(() => data(`contractDrafts/${projectId}`), (value) => Boolean(value?.documentHash));
  await command("bookingCommand", "prepareContract", studio.tenantId, { projectId, proposalId, overrides: {} }, studio.owner).catch(() => undefined);
  const prepared = (await data(`contractDrafts/${projectId}`)) ?? drafted;
  await command("bookingCommand", "sendContract", studio.tenantId, {
    projectId, documentHash: prepared?.documentHash, studioSignerName: `${studio.name} owner`, consent: true,
  }, studio.owner);
  const contract = (await query("contracts", studio.tenantId, { projectId }))[0];
  await portal("sign_contract", {
    tenantId: studio.tenantId, projectId, contractId: contract.id, documentHash: contract.documentHash, typedName: input.client,
    consent: true, consentVersion: "esign-consent-v2", billingAddress: { line1: "14 Mill Lane", line2: null, city: "Montclair", region: "NJ", postalCode: "07042", country: "US" },
  }, clientEmail);
  const retainer = await waitFor(
    async () => (await query("invoiceReferences", studio.tenantId, { projectId })).find((invoice) => invoice.kind === "retainer"),
    (value) => Boolean(value),
  );
  await drainAll("providerJobs", studio.tenantId);
  await command("bookingCommand", "recordRetainerPayment", studio.tenantId, {
    projectId, packageSnapshotId, paidAt: day(0), method: "card", reference: null, attestation: true,
  }, studio.owner);
  const booked = await waitFor(() => data(`projects/${projectId}`), (value) => value?.state === "BOOKED", 30000);
  await drainAll("providerJobs", studio.tenantId);
  return { proposalId, packageSnapshotId, contract, retainer, booked, sent };
}

// ═══════════════════════════ J3 · Makeup bridal party ═══════════════════════
journey = "J3 makeup";
{
  const studio = studios.makeup;
  await attempt("studio ready", () => studioReady(studio, beautyAgreement));
  // The bride's package and the bridesmaids per person.
  const addOn = await command("crmCommand", "saveAddOn", studio.tenantId, {
    addOnId: null, name: "Bridesmaid makeup", description: "Full makeup for each bridesmaid.", unitPriceCents: 12000, taxable: false, allowQuantity: true, unitLabel: "person", archived: false,
  }, studio.owner);
  const addOnId = String(addOn.addOnId ?? addOn.id);
  const pkg = await command("crmCommand", "createPackage", studio.tenantId, {
    name: "Bridal makeup with trial", description: "A trial a few months before, then your makeup on the morning.", eventTypeId: "wedding", eventTypeLabel: "Wedding",
    basePriceCents: 65000, currency: "USD", retainerRule: { type: "percentage", basisPoints: 2500 }, includedCoverageMinutes: 180,
    includedCoverage: [{ role: "makeup_artist", count: 2 }], includedDeliverables: ["Makeup trial", "Bridal makeup", "Lashes"], includedTravelArea: "Within 30 miles",
    addOns: [], addOnIds: [addOnId], taxRateBasisPoints: 0, terms: "Subject to the signed agreement.", active: true, publicVisible: true, displayOrder: 1, internalNotes: "",
  }, studio.owner);
  record("package and per-person extra saved", Boolean(pkg.packageId), `package ${pkg.packageId}, extra ${addOnId}`);

  const eventDate = day(200);
  const inquiry = await attempt("inquiry from the website form", () =>
    inquire(studio, { first: "Maya", last: "Brooks", eventDate, message: "Six of us getting ready at Hollow Oak Inn.", answers: { "party-size": "4–6", "ready-by": "1:00 PM", "trial-wanted": "yes" } }),
  );
  if (inquiry) {
    const { projectId, leadId, clientEmail } = inquiry;
    const project = await data(`projects/${projectId}`);
    record("inquiry is a job on arrival, at Lead", project?.state === "LEAD", `state ${project?.state}, kind ${project?.eventKind}`);
    const answers = (inquiry.lead?.customAnswers ?? []).map((row) => `${row.questionId}=${row.answer}`).join(", ");
    record("the beauty questions are kept on the inquiry", /party-size=4–6/.test(answers) && /trial-wanted=Yes/.test(answers), answers);

    // Cue's first reply, drafted in mock mode and approved.
    await drain("aiJobs", `lead_intake_${leadId}`);
    const reply = await waitFor(() => data(`aiActions/ai_reply_${leadId}`), (value) => Boolean(value));
    const replyBody = String(reply?.structuredOutput?.body ?? "");
    record("first reply promises the price, not a call", /we'll send your price/.test(replyBody) && !/pick a time to talk/i.test(replyBody), replyBody.split("\n").slice(-4).join(" ").slice(0, 200));
    record("first reply never says photography", !PHOTO_WORDS.test(replyBody), PHOTO_WORDS.exec(replyBody)?.[0] ?? "clean");
    const ack = await email(studio.tenantId, "inquiry_acknowledgement");
    record("the inquiry acknowledgement never says photography", ack !== null && !PHOTO_WORDS.test(ack.text), ack ? `${ack.subject} | ${PHOTO_WORDS.exec(ack.text)?.[0] ?? "clean"}` : "no email");

    const booked = await attempt("quote → accepted → signed → paid → booked", () =>
      bookToBooked(studio, { projectId, clientEmail, client: "Maya Brooks", packageId: String(pkg.packageId), addOns: [{ addOnId, quantity: 5 }] }),
    );
    if (booked) {
      record("the quote email says quote", booked.sent?.subject === `Your quote from ${studio.name}` && !PHOTO_WORDS.test(booked.sent?.text ?? ""), `${booked.sent?.subject}`);
      const snapshot = await data(`packageSnapshots/${booked.packageSnapshotId}`);
      const line = (snapshot?.addOns ?? [])[0];
      record("5 bridesmaids priced per person", line?.quantity === 5 && line?.unitLabel === "person" && snapshot?.totalCents === 65000 + 5 * 12000, `qty ${line?.quantity} ${line?.unitLabel}, total ${snapshot?.totalCents}`);
      const contractText = JSON.stringify(booked.contract?.document ?? booked.contract ?? {});
      record("the agreement carries the beauty Schedule A and headcount rule", /people can be added but not taken off/.test(contractText) && /Getting ready/.test(contractText), /Party size/.test(contractText) ? "party size listed" : "no party size line");
      record("booked", booked.booked?.state === "BOOKED", `state ${booked.booked?.state}`);

      // The Party list goes out at booking.
      const forms = await waitFor(() => query("questionnaireResponses", studio.tenantId, { projectId }), (rows) => rows.length > 0);
      const partyList = forms.find((row) => /Party list/.test(String(row.templateName ?? "")));
      record("the Party list goes out at booking", Boolean(partyList), forms.map((row) => `${row.templateName}:${row.status}`).join(", ") || "none");
      const request = await email(studio.tenantId, "questionnaire_request", projectId);
      record("its email never says photography", request !== null && !PHOTO_WORDS.test(words(request.text)), request ? `${request.subject} (P3: doesn't name the Party list)` : "no email");

      // The trial: invited from the job, booked by the client from the link.
      const invited = await attempt("trial invite", () =>
        post("publicConsultationScheduling", { type: "create_link", tenantId: studio.tenantId, idempotencyKey: randomUUID(), input: { projectId, contactId: (booked.booked?.clientContactIds ?? [])[0], mode: "in_person", purpose: "trial" } }, studio.owner),
      );
      const invite = await email(studio.tenantId, "consultation_invitation", projectId);
      record("the trial invitation says trial", invite !== null && /makeup trial/i.test(invite.subject) && !/consultation|photograph/i.test(words(invite.text)), invite ? invite.subject : "no email");
      const trialToken = tokenFrom(invite?.job?.actionUrl ?? invite?.job?.values?.actionUrl);
      const slots = await attempt("trial slots", () => post("publicConsultationScheduling", { type: "availability", idempotencyKey: randomUUID(), input: { token: trialToken } }));
      const slot = (slots?.slots ?? [])[0];
      if (slot) await attempt("trial booked", () => post("publicConsultationScheduling", { type: "book", idempotencyKey: randomUUID(), input: { token: trialToken, startsAt: slot.startsAt } }));
      const trial = (await query("consultations", studio.tenantId, { projectId })).find((row) => row.purpose === "trial");
      const afterTrial = await data(`projects/${projectId}`);
      record("the trial is booked and the job stays booked", Boolean(trial) && afterTrial?.state === "BOOKED", `trial ${trial?.status ?? "none"} at ${trial?.startsAt ?? "-"}; job ${afterTrial?.state}; invite ${invited ? "sent" : "failed"}`);
      const confirmation = await email(studio.tenantId, "consultation_confirmation", projectId);
      record("the trial confirmation never says consultation or photography", confirmation !== null && !/consultation|photograph/i.test(words(`${confirmation.subject} ${confirmation.text}`)), confirmation ? confirmation.subject : "no email");

      await command("crewCommand", "setTrialNotes", studio.tenantId, { projectId, look: "Soft glam, warm brown eye", products: "Luminous Silk 5.5, Wispies lashes" }, studio.owner);

      // The client fills in the Party list.
      if (partyList) {
        const list = ["Maya Brooks — bride — makeup — sensitive skin", "Jess Hart — maid of honor — makeup — lashes", "Priya Shah — bridesmaid — makeup", "Kate Moore — bridesmaid", "Ana Brooks — mother of the bride", "Lily — flower girl"].join("\n");
        await attempt("client submits the Party list", () =>
          command("planningCommand", "saveQuestionnaire", studio.tenantId, {
            responseId: partyList.id, projectId,
            answers: { "ready-by-time": "13:00", "earliest-start-time": "08:00", "getting-ready": "Hollow Oak Inn, bridal suite", "party-list": list, "skin-type": "Sensitive", "lashes": "Yes, me and my party" },
            submit: true,
          }, clientEmail),
        );
        const submitted = await data(`questionnaireResponses/${partyList.id}`);
        record("the Party list is submitted", submitted?.status === "submitted", `status ${submitted?.status}`);

        // Lay out the morning (the editor's own functions) and publish it.
        const plan = planChairs({ people: parsePartyList(list, "makeup"), service: "makeup", readyBy: "13:00", earliestStart: "08:00", artists: 2 });
        const morning = chairDayPlan(plan, { service: "makeup", place: "Hollow Oak Inn, bridal suite", readyBy: "13:00" });
        const bride = plan.slots.filter((slot) => slot.artist === 1);
        record("the morning: 6 chairs on 2 artists, bride mid-chair, all ready by 1:00", plan.slots.length === 6 && plan.fits && bride.findIndex((slot) => slot.role === "bride") > 0, morning.notes.join(" "));
        const isoAt = (clock: string) => new Date(`${eventDate}T${clock}:00-04:00`).toISOString();
        await attempt("publish the getting-ready schedule", () =>
          command("planningCommand", "publishSchedule", studio.tenantId, {
            projectId, timezone: "America/New_York", coverageMinutes: 300,
            items: morning.rows.map((row, index) => ({
              id: `chair-${index}`, startAt: isoAt(row.time), endAt: row.end ? isoAt(row.end) : null, title: row.title, description: "", location: row.where, address: null,
              travelMinutes: 0, photographerIds: [], participants: [], vendorContactIds: [], equipment: [], notes: null, visibility: "shared", blockingIssues: [],
              sourceReferences: [{ type: "questionnaire_answer", sourceId: `day_plan_${row.key}`, label: row.sourceLabel }],
            })),
          }, studio.owner),
        );
        const schedule = (await query("schedules", studio.tenantId, { projectId })).find((row) => row.status === "published");
        record("the schedule is published with each chair named", Boolean(schedule) && (schedule.items ?? []).every((item) => /^Chair \d/.test(String(item.sourceReferences?.[0]?.label ?? ""))), `${schedule?.items?.length ?? 0} lines`);
      }

      // Leah takes chair 2.
      const crew = await attempt("crew profile", () =>
        command("crewCommand", "createCrewProfile", studio.tenantId, {
          name: "Leah Park", email: `uat-makeup-crew-${run}@studiohub.test`, phone: null, specialties: ["Bridal"], trades: ["makeup_artist"], serviceAreas: ["NJ"], travelRadiusMiles: 30, rateType: "event", rateCents: 30000, currency: "USD",
        }, studio.owner),
      );
      const crewProfileId = String(crew?.crewProfileId ?? crew?.id ?? "");
      const offer = crew && await attempt("offer chair 2", () =>
        command("crewCommand", "inviteAssignment", studio.tenantId, {
          projectId, crewProfileId, userId: null, role: "Makeup artist", compensationCents: 30000, compensationType: "event", currency: "USD", compensationVisibleToCrew: true,
          arrivalAt: new Date(`${eventDate}T07:45:00-04:00`).toISOString(), departureAt: new Date(`${eventDate}T13:30:00-04:00`).toISOString(),
          locations: [{ name: "Hollow Oak Inn, bridal suite", address: null }], responsibilities: ["Chair 2"], scheduleItemIds: [], currentScheduleId: null, currentScheduleVersion: 0, requirements: [],
        }, studio.owner),
      );
      const crewInvite = await email(studio.tenantId, "crew_invitation", projectId);
      record("the crew offer speaks makeup, not photography", crewInvite !== null && !PHOTO_WORDS.test(words(crewInvite.text)) && /a makeup assignment/.test(crewInvite.text), crewInvite ? `${crewInvite.subject} | ${PHOTO_WORDS.exec(words(crewInvite.text))?.[0] ?? "clean"}` : "no email");
      if (offer && crewInvite) {
        const crewEmail = `uat-makeup-crew-${run}@studiohub.test`;
        await account(crewEmail, "Leah Park");
        const crewToken = String(crewInvite.job?.inviteToken ?? tokenFrom(crewInvite.job?.actionUrl));
        await attempt("crew accepts the invitation", () => post("crewInvitationCommand", { token: crewToken, idempotencyKey: randomUUID() }, crewEmail));
        const assignmentId = String(offer.assignmentId ?? offer.id ?? crewInvite.job?.assignmentId ?? "");
        await attempt("crew accepts the job", () => command("crewCommand", "respondAssignment", studio.tenantId, { projectId, assignmentId, decision: "accepted", reason: "" }, crewEmail));
        const assignment = await data(`crewAssignments/${assignmentId}`);
        record("Leah is on chair 2", assignment?.status === "accepted", `status ${assignment?.status}`);
        const brief = await data(`crewBriefs/trial_${projectId}`);
        record("the trial look is on the crew brief", /Soft glam/.test(JSON.stringify(brief ?? {})), brief ? "From the trial" : "no brief");
      }

      // The headcount lock, 30 days out.
      await db.doc(`projects/${projectId}`).set({ eventDate: day(25) }, { merge: true });
      await finalDetailsScheduler.run({});
      const lockEmail = await email(studio.tenantId, "final_details_request", projectId);
      record("the lock reaches a makeup job 30 days out", Boolean(await data(`detailSignoffs/${studio.tenantId}_${projectId}`)), lockEmail ? lockEmail.subject : "no email");
      record("the lock email speaks of the morning and the headcount, never photos", lockEmail !== null && !PHOTO_WORDS.test(words(lockEmail.text)) && /people can be added but not taken off/.test(lockEmail.text), lockEmail ? PHOTO_WORDS.exec(words(lockEmail.text))?.[0] ?? "clean" : "no email");

      // The final bill, due on the day.
      await finalInvoiceScheduler.run({});
      const final = await data(`invoiceReferences/final_${projectId}`);
      record("the balance is due on the day", String(final?.dueDate ?? "").slice(0, 10) === day(25), `final ${final?.status ?? "none"} due ${final?.dueDate ?? "-"} (event ${day(25)})`);

      // The week before: the prep guide; two days before: the crew reminder with the kit.
      await db.doc(`projects/${projectId}`).set({ eventDate: day(5) }, { merge: true });
      await sweepEventReminders(db, new Date());
      const guide = await email(studio.tenantId, "event_reminder", projectId);
      record("the week-before email is the prep guide", guide?.subject === `Your prep guide from ${studio.name}` && /button-up/.test(guide?.text ?? ""), guide ? guide.subject : "no email");

      // Lifecycle drafts in the last 30 days: what the client would be offered.
      await lifecycleMessageScheduler.run({});
      const drafts = (await query("aiActions", studio.tenantId)).filter((row) => row.projectId === projectId && String(row.id).startsWith("ai_lifecycle"));
      for (const draftAction of drafts) {
        const body = String(draftAction.structuredOutput?.body ?? "");
        record(`lifecycle draft "${String(draftAction.id).split("_").slice(-1)[0]}" fits a makeup client`, !PHOTO_WORDS.test(body) && !/Dress on its special hanger|rings together/.test(body), body.split("\n").find((lineText) => lineText.startsWith("•")) ?? body.slice(0, 120));
      }

      // The day before: what the lifecycle drafts for the client, if anything.
      await db.doc(`projects/${projectId}`).set({ eventDate: day(1) }, { merge: true });
      await lifecycleMessageScheduler.run({});
      const dayBefore = (await query("aiActions", studio.tenantId)).find((row) => row.projectId === projectId && /day_before_checklist/.test(String(row.id)));
      const dayBeforeBody = String(dayBefore?.structuredOutput?.body ?? "");
      record("no wedding dress checklist for a makeup client the day before", !/Dress on its special hanger|rings together/.test(dayBeforeBody), dayBefore ? dayBeforeBody.split("\n").filter((lineText) => lineText.startsWith("•")).join(" ") : "no day-before draft (prep guide and kit checklist instead)");
      // The calendar moved the day; the crew's call moves with it, as the studio would set it.
      for (const assignment of await query("crewAssignments", studio.tenantId, { projectId })) {
        await db.doc(`crewAssignments/${assignment.id}`).set({
          arrivalAt: new Date(`${day(1)}T07:45:00-04:00`).toISOString(), departureAt: new Date(`${day(1)}T13:30:00-04:00`).toISOString(),
        }, { merge: true });
      }
      const crewReminderSweep = await sweepEventReminders(db, new Date());
      const crewReminder = await email(studio.tenantId, "crew_reminder");
      record("the crew reminder carries the kit checklist", crewReminder !== null && /Kit checklist — before you leave/.test(crewReminder.text) && /getting-ready schedule/.test(crewReminder.text), crewReminder ? crewReminder.subject : `no email (${JSON.stringify(crewReminderSweep)})`);

      // The day, then the review.
      let current = await data(`projects/${projectId}`);
      await attempt("event complete", () => command("crmCommand", "transitionProject", studio.tenantId, { projectId, expectedVersion: current?.stateVersion, targetState: "EVENT_COMPLETE", reason: "The morning happened.", notifyClient: false, clientMessage: null }, studio.owner));
      current = await data(`projects/${projectId}`);
      await attempt("to the review, with nothing to deliver", () => command("crmCommand", "transitionProject", studio.tenantId, { projectId, expectedVersion: current?.stateVersion, targetState: "REVIEW_REQUESTED", reason: "Asking for a review.", notifyClient: false, clientMessage: null }, studio.owner));
      current = await data(`projects/${projectId}`);
      record("all done, then the review", current?.state === "REVIEW_REQUESTED", `state ${current?.state}`);
      const review = await attempt("review request drafted", () =>
        post("aiMessageDraftCommand", { tenantId: studio.tenantId, trigger: "review_request", projectId, leadId: null, conversationId: null, instructions: "" }, studio.owner),
      );
      const reviewAction = (await query("aiActions", studio.tenantId)).filter((row) => row.projectId === projectId && /review/.test(String(row.capability ?? row.id))).pop();
      const reviewBody = String(reviewAction?.structuredOutput?.body ?? "");
      record("the review request never mentions a gallery or photos", Boolean(review) && !PHOTO_WORDS.test(reviewBody), reviewBody.slice(0, 160) || "no draft");
    }
  }
}

// ═══════════════════════════ J4 · The late hair booking ═══════════════════
journey = "J4 hair";
{
  const studio = studios.hair;
  await attempt("studio ready", () => studioReady(studio, beautyAgreement));
  const addOn = await command("crmCommand", "saveAddOn", studio.tenantId, {
    addOnId: null, name: "Bridesmaid hair", description: "Styling for each bridesmaid.", unitPriceCents: 9500, taxable: false, allowQuantity: true, unitLabel: "person", archived: false,
  }, studio.owner);
  const addOnId = String(addOn.addOnId ?? addOn.id);
  const pkg = await command("crmCommand", "createPackage", studio.tenantId, {
    name: "Bridal hair with trial", description: "A trial once your veil is chosen, then your hair on the morning.", eventTypeId: "wedding", eventTypeLabel: "Wedding",
    basePriceCents: 45000, currency: "USD", retainerRule: { type: "percentage", basisPoints: 2500 }, includedCoverageMinutes: 180,
    includedCoverage: [{ role: "hair_stylist", count: 1 }], includedDeliverables: ["Hair trial", "Bridal hair", "Veil placement"], includedTravelArea: "Within 30 miles",
    addOns: [], addOnIds: [addOnId], taxRateBasisPoints: 0, terms: "Subject to the signed agreement.", active: true, publicVisible: true, displayOrder: 1, internalNotes: "",
  }, studio.owner);
  const eventDate = day(49);
  const inquiry = await attempt("late inquiry, seven weeks out", () =>
    inquire(studio, { first: "Priya", last: "Shah", eventDate, message: "Hair for me and four bridesmaids, getting ready at the inn.", answers: { "party-size": "4–6", "ready-by": "12:30 PM", "trial-wanted": "yes" } }),
  );
  if (inquiry) {
    const { projectId, clientEmail } = inquiry;
    const booked = await attempt("quote → booked", () =>
      bookToBooked(studio, { projectId, clientEmail, client: "Priya Shah", packageId: String(pkg.packageId), addOns: [{ addOnId, quantity: 4 }] }),
    );
    if (booked) {
      record("booked", booked.booked?.state === "BOOKED", `state ${booked.booked?.state}`);
      const forms = await waitFor(() => query("questionnaireResponses", studio.tenantId, { projectId }), (rows) => rows.length > 0);
      const partyList = forms.find((row) => /Party list/.test(String(row.templateName ?? "")));
      const sections = JSON.stringify(partyList?.templateSnapshot ?? partyList ?? {});
      record("the hair Party list asks about extensions and the veil", /your-hair/.test(sections) && /veil/i.test(sections), partyList ? String(partyList.templateName) : "none");

      await attempt("trial invite", () =>
        post("publicConsultationScheduling", { type: "create_link", tenantId: studio.tenantId, idempotencyKey: randomUUID(), input: { projectId, contactId: (booked.booked?.clientContactIds ?? [])[0], mode: "in_person", purpose: "trial" } }, studio.owner),
      );
      const invite = await email(studio.tenantId, "consultation_invitation", projectId);
      record("the hair trial invitation waits for the veil", invite !== null && /book once you have/.test(invite.text) && /veil/.test(invite.text), invite ? invite.subject : "no email");

      // Extensions to rent, with the color match, at the trial.
      const save = (extensions: string | null) =>
        command("crewCommand", "setTrialNotes", studio.tenantId, { projectId, look: "Low textured bun, veil under the bun", products: "Texturizing spray", extensions, colorMatch: "#6/8 balayage, 18 inches" }, studio.owner);
      await attempt("trial notes with rental extensions", () => save("rent"));
      const tasks = async () => (await query("tasks", studio.tenantId, { projectId })).filter((task) => task.source === "trial_extensions");
      let open = await tasks();
      const order = open.find((task) => String(task.id).startsWith("extensions_order_"));
      const collect = open.find((task) => String(task.id).startsWith("extensions_return_"));
      record("late booking: the order is due today", order?.dueDate === day(0), `${order?.title} due ${order?.dueDate}`);
      record("a rental is collected four days after", collect?.dueDate === new Date(Date.parse(`${eventDate}T12:00:00Z`) + 4 * 86_400_000).toISOString().slice(0, 10), `${collect?.title} due ${collect?.dueDate}`);
      await attempt("saved again", () => save("rent"));
      open = await tasks();
      record("saving again never doubles the tasks", open.length === 2, `${open.length} tasks`);
      await attempt("plan changed to none", () => save("none"));
      open = await tasks();
      record("no extensions cancels both tasks", open.every((task) => task.status === "cancelled"), open.map((task) => task.status).join(", "));
      await attempt("back to renting", () => save("rent"));
      open = await tasks();
      record("renting again reopens them", open.every((task) => task.status === "not_started"), open.map((task) => task.status).join(", "));
      const brief = JSON.stringify((await data(`crewBriefs/trial_${projectId}`)) ?? {});
      record("the crew brief names the rental and the color", /Renting them — color match #6\/8 balayage/.test(brief), brief.slice(0, 120));

      // Two more bridesmaids after the headcount lock: a booking change she signs.
      const projectNow = await data(`projects/${projectId}`);
      const amendment = await attempt("draft the change: 4 → 6 bridesmaids", () =>
        command("bookingCommand", "draftAmendment", studio.tenantId, {
          projectId, eventDate: null, keepPackageSnapshotIds: [booked.packageSnapshotId], addPackageIds: [], allowDateClash: false, moveConsultationIds: [],
          extras: [{ packageSnapshotId: booked.packageSnapshotId, addOns: [{ addOnId, quantity: 6 }] }], oneOffPackage: null, note: "Two more bridesmaids.",
        }, studio.owner),
      );
      const amendmentId = String(amendment?.amendmentId ?? amendment?.id ?? "");
      const drafted = amendmentId ? await data(`bookingAmendments/${amendmentId}`) : null;
      if (drafted) {
        await attempt("send the change", () => command("bookingCommand", "sendAmendment", studio.tenantId, { amendmentId, documentHash: drafted.documentHash, studioSignerName: `${studio.name} owner`, consent: true }, studio.owner));
        await attempt("she signs it", () => portal("sign_amendment", {
          tenantId: studio.tenantId, projectId, amendmentId, documentHash: drafted.documentHash, typedName: "Priya Shah", consent: true, consentVersion: "esign-consent-v2",
          billingAddress: { line1: "14 Mill Lane", line2: null, city: "Montclair", region: "NJ", postalCode: "07042", country: "US" },
        }, clientEmail));
        const applied = await waitFor(() => data(`projects/${projectId}`), (value) => value?.packageSnapshotId && value.packageSnapshotId !== projectNow?.packageSnapshotId, 30000);
        const snapshot = await data(`packageSnapshots/${applied?.packageSnapshotId}`);
        const line = (snapshot?.addOns ?? [])[0];
        record("the change is applied: 6 bridesmaids, still per person", line?.quantity === 6 && line?.unitLabel === "person", `qty ${line?.quantity} ${line?.unitLabel ?? "(no unit)"}, total ${snapshot?.totalCents}`);
      } else record("the change is drafted", false, "no amendment");

      // Her email changes; what goes out next follows it.
      const contactId = (booked.booked?.clientContactIds ?? [])[0];
      const newEmail = `uat-hair-client-new-${run}@studiohub.test`;
      await attempt("email changed", () => command("crmCommand", "updateContact", studio.tenantId, { contactId, firstName: "Priya", lastName: "Shah", displayName: null, email: newEmail, phone: null, company: null, notes: null }, studio.owner));

      // The week before: the prep guide, to the new address, with the blow-dry rule.
      await db.doc(`projects/${projectId}`).set({ eventDate: day(5) }, { merge: true });
      await sweepEventReminders(db, new Date());
      const guide = await email(studio.tenantId, "event_reminder", projectId);
      record("the hair prep guide asks for dry hair or a blow-dry fee", /blow-dry fee/.test(guide?.text ?? ""), guide ? guide.subject : "no email");
      record("it goes to her new address", guide?.recipient === newEmail, `to ${guide?.recipient || "-"}`);

      let current = await data(`projects/${projectId}`);
      await attempt("event complete", () => command("crmCommand", "transitionProject", studio.tenantId, { projectId, expectedVersion: current?.stateVersion, targetState: "EVENT_COMPLETE", reason: "The morning happened.", notifyClient: false, clientMessage: null }, studio.owner));
      current = await data(`projects/${projectId}`);
      record("all done", current?.state === "EVENT_COMPLETE", `state ${current?.state}`);
    }
  }
}

// ═══════════════════════════ J2 · The DJ's wedding ═════════════════════════
journey = "J2 DJ";
{
  const studio = studios.dj;
  const djAgreement = starterAgreementFor("dj").body
    .replace(/\[Replace with your own cancellation[^\]]*\]/, "The retainer is non-refundable. A new date within a year can be arranged once.")
    .replace(/\[Replace with your own terms on power[^\]]*\]/, "The venue provides two 20-amp outlets within 25 feet of the setup.")
    .replace(/\[Replace with your own terms\.\]/, "The Studio's liability is limited to the fees paid.");
  await attempt("studio ready", () => studioReady(studio, djAgreement));
  const pkg = await command("crmCommand", "createPackage", studio.tenantId, {
    name: "Ceremony and reception", description: "Ceremony sound, cocktail hour music, and the reception with MC.", eventTypeId: "wedding", eventTypeLabel: "Wedding",
    basePriceCents: 240000, currency: "USD", retainerRule: { type: "percentage", basisPoints: 2500 }, includedCoverageMinutes: 360,
    includedCoverage: [{ role: "dj", count: 1 }], includedDeliverables: ["Ceremony sound", "Reception sound", "MC"], includedTravelArea: "Within 50 miles",
    addOns: [], addOnIds: [], taxRateBasisPoints: 0, terms: "Subject to the signed agreement.", active: true, publicVisible: true, displayOrder: 1, internalNotes: "",
  }, studio.owner);
  const eventDate = day(220);
  const inquiry = await attempt("inquiry: hours of music, ceremony too", () =>
    inquire(studio, { first: "Maya", last: "Brooks", eventDate, message: "Ceremony and reception at Hollow Oak Inn.", answers: { "music-hours": "6 hours", "ceremony-music": "yes" } }),
  );
  if (inquiry) {
    const { projectId, leadId, clientEmail } = inquiry;
    await drain("aiJobs", `lead_intake_${leadId}`);
    const reply = await waitFor(() => data(`aiActions/ai_reply_${leadId}`), (value) => Boolean(value));
    const replyBody = String(reply?.structuredOutput?.body ?? "");
    record("a DJ's first reply offers a time to talk", /pick a time to talk/.test(replyBody) && !PHOTO_WORDS.test(words(replyBody)), replyBody.split("\n").slice(-3).join(" ").slice(0, 160));
    // The vibe call, booked from the couple's own link after the event form.
    const linkToken = (replyBody.match(/\/i\/([A-Za-z0-9_-]+)/) ?? [])[1] ?? "";
    const preview = await attempt("inquiry link preview", () => post("publicConsultationScheduling", { type: "inquiry_preview", idempotencyKey: randomUUID(), input: { token: linkToken } }));
    record("the couple's page offers a call", preview?.offersConsultation === true, `offersConsultation ${preview?.offersConsultation}, form ${JSON.stringify(preview?.eventForm ?? null)}`);
    if (preview?.eventForm) {
      // Every required question answered the way a couple would (the form is the studio's own).
      const form = await attempt("event form opens", () => post("publicConsultationScheduling", { type: "inquiry_form", idempotencyKey: randomUUID(), input: { token: linkToken } }));
      const answers: Record<string, unknown> = { ...(form?.answers ?? {}) };
      for (const section of form?.sections ?? []) {
        for (const field of section.fields ?? []) {
          if (!field.required || answers[field.id]) continue;
          answers[field.id] =
            field.type === "date" ? eventDate
            : field.type === "time" ? "16:00"
            : field.type === "datetime" ? `${eventDate}T16:00`
            : ["radio", "select", "choice", "single_select"].includes(field.type) ? field.options?.[0]
            : field.type === "multi_select" ? [field.options?.[0]].filter(Boolean)
            : ["yes_no", "boolean", "checkbox", "acknowledgement"].includes(field.type) ? true
            : field.type === "number" ? 140
            : /email/.test(field.type) ? "planner@studiohub.test"
            : /phone/.test(field.type) ? "201-555-0177"
            : "Hollow Oak Inn, 1 Oak Road, Montclair NJ";
        }
      }
      await attempt("event form", () => post("publicConsultationScheduling", { type: "inquiry_form_save", idempotencyKey: randomUUID(), input: { token: linkToken, answers, submit: true } }));
    }
    const slots = await attempt("vibe call times", () => post("publicConsultationScheduling", { type: "inquiry_availability", idempotencyKey: randomUUID(), input: { token: linkToken } }));
    const slot = (slots?.slots ?? [])[0];
    if (slot) await attempt("vibe call booked", () => post("publicConsultationScheduling", { type: "inquiry_book", idempotencyKey: randomUUID(), input: { token: linkToken, startsAt: slot.startsAt, format: "in_person" } }));
    const call = (await query("consultations", studio.tenantId, { projectId }))[0];
    const confirmation = await email(studio.tenantId, "consultation_confirmation", projectId);
    record("the vibe call is booked and named", Boolean(call) && /vibe call/i.test(`${confirmation?.subject} ${confirmation?.text}`) && !PHOTO_WORDS.test(words(confirmation?.text ?? "")), confirmation ? confirmation.subject : `no email (call ${call?.status ?? "none"})`);
    if (call) await attempt("vibe call held", () => command("bookingCommand", "completeConsultation", studio.tenantId, { projectId, consultationId: call.id, notes: "Loves 80s, no line dances, MC light." }, studio.owner));

    const booked = await attempt("proposal → booked", () =>
      bookToBooked(studio, { projectId, clientEmail, client: "Maya Brooks", packageId: String(pkg.packageId), addOns: [] }),
    );
    if (booked) {
      record("the proposal says proposal, never photography", booked.sent?.subject === `Your proposal from ${studio.name}` && !PHOTO_WORDS.test(words(booked.sent?.text ?? "")), String(booked.sent?.subject));
      const forms = await waitFor(() => query("questionnaireResponses", studio.tenantId, { projectId }), (rows) => rows.some((row) => /Music/.test(String(row.templateName ?? ""))));
      const planner = forms.find((row) => /Music/.test(String(row.templateName ?? "")));
      record("the Music & moments planner goes out at booking", Boolean(planner), forms.map((row) => `${row.templateName}:${row.status}`).join(", "));
      // The lock, 10 days out, with the final planning call.
      await db.doc(`projects/${projectId}`).set({ eventDate: day(9) }, { merge: true });
      await finalDetailsScheduler.run({});
      const lock = await email(studio.tenantId, "final_details_request", projectId);
      record("the planner locks 10 days out and offers the final planning call", lock !== null && /Book your final planning call/.test(lock.text) && /Music & moments planner/.test(lock.text) && !PHOTO_WORDS.test(words(lock.text)), lock ? lock.subject : "no email");
      await finalInvoiceScheduler.run({});
      const final = await data(`invoiceReferences/final_${projectId}`);
      record("a DJ's balance is due 14 days before", String(final?.dueDate ?? "").slice(0, 10) === new Date(Date.parse(`${day(9)}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10), `due ${final?.dueDate ?? "-"} (event ${day(9)})`);
      // Rico plays it.
      const crew = await attempt("crew profile", () => command("crewCommand", "createCrewProfile", studio.tenantId, {
        name: "Rico Diaz", email: `uat-dj-crew-${run}@studiohub.test`, phone: null, specialties: ["Weddings"], trades: ["dj"], serviceAreas: ["NJ"], travelRadiusMiles: 50, rateType: "event", rateCents: 60000, currency: "USD",
      }, studio.owner));
      if (crew) {
        await attempt("offer the night", () => command("crewCommand", "inviteAssignment", studio.tenantId, {
          projectId, crewProfileId: String(crew.crewProfileId ?? crew.id), userId: null, role: "DJ", compensationCents: 60000, compensationType: "event", currency: "USD", compensationVisibleToCrew: true,
          arrivalAt: new Date(`${day(9)}T14:00:00-04:00`).toISOString(), departureAt: new Date(`${day(9)}T23:30:00-04:00`).toISOString(),
          locations: [{ name: "Hollow Oak Inn", address: null }], responsibilities: ["Ceremony and reception"], scheduleItemIds: [], currentScheduleId: null, currentScheduleVersion: 0, requirements: [],
        }, studio.owner));
        const offer = await email(studio.tenantId, "crew_invitation", projectId);
        record("Rico's offer is a DJ assignment", offer !== null && /a DJ assignment/.test(offer.text) && !PHOTO_WORDS.test(words(offer.text)), offer ? offer.subject : "no email");
      }
      // The day before: a DJ's own checklist.
      await db.doc(`projects/${projectId}`).set({ eventDate: day(1) }, { merge: true });
      await lifecycleMessageScheduler.run({});
      const dayBefore = (await query("aiActions", studio.tenantId)).find((row) => row.projectId === projectId && /day_before_checklist/.test(String(row.id)));
      const body = String(dayBefore?.structuredOutput?.body ?? "");
      record("the day-before checklist asks for last song changes", /last song changes/i.test(body) && !/Dress on its special hanger/.test(body), body.split("\n").filter((lineText) => lineText.startsWith("•")).join(" ") || "no draft");
      let current = await data(`projects/${projectId}`);
      await attempt("played", () => command("crmCommand", "transitionProject", studio.tenantId, { projectId, expectedVersion: current?.stateVersion, targetState: "EVENT_COMPLETE", reason: "The night happened.", notifyClient: false, clientMessage: null }, studio.owner));
      current = await data(`projects/${projectId}`);
      await attempt("to the review", () => command("crmCommand", "transitionProject", studio.tenantId, { projectId, expectedVersion: current?.stateVersion, targetState: "REVIEW_REQUESTED", reason: "Asking for a review.", notifyClient: false, clientMessage: null }, studio.owner));
      current = await data(`projects/${projectId}`);
      record("played, then the review", current?.state === "REVIEW_REQUESTED", `state ${current?.state}`);
    }
  }
}

// ═══════════════════════════ J9 · A new studio's first day ═══════════════
journey = "J9 new studio";
{
  const { queueTrialSeries } = await import(`${REPO}/functions/src/saas/billing-notices.ts`);
  const { captureInquiry } = await import(`${REPO}/functions/src/intake/capture.ts`);
  const owner = `uat-brightside-${run}@studiohub.test`;
  await account(owner, "Brightside owner");
  const created = await post("tenantOnboardingCommand", { businessName: "Brightside Portraits", legalName: "Brightside Portraits LLC", timezone: "America/Chicago", currency: "USD", trade: "photographer" }, owner);
  const tenantId = String(created.tenantId);
  tokens.delete(owner);
  const trialEnds = new Date(Date.now() + 12 * 86_400_000).toISOString();
  await db.doc(`subscriptions/${tenantId}`).set({ status: "trialing", checkoutRequired: false, currentPeriodEnd: trialEnds, trialEnd: trialEnds, currentPeriodStart: new Date(Date.now() - 2 * 86_400_000).toISOString() }, { merge: true });
  record("photographer studio onboarded", (await data(`tenants/${tenantId}`))?.trade === "photographer", "Brightside Portraits");

  // Twelve bookings from the spreadsheet; three here, each a different shape.
  const bookings = [
    { first: "Linh", last: "Nguyen", email: `uat-nguyen-${run}@studiohub.test`, type: "portraits", label: "Family session", date: day(16), total: 45000, paid: [{ amountCents: 45000, paidOn: day(-20), method: "Venmo" }] },
    { first: "Ava", last: "Cole", email: `uat-cole-${run}@studiohub.test`, type: "portraits", label: "Newborn session", date: day(40), total: 60000, paid: [] },
    { first: "Harper", last: "Lane", email: `uat-lane-${run}@studiohub.test`, type: "wedding", label: "Wedding", date: day(120), total: 480000, paid: [{ amountCents: 120000, paidOn: day(-60), method: "Check" }] },
  ];
  for (const booking of bookings) {
    await attempt(`import ${booking.label}`, () =>
      command("bookingCommand", "importExistingBooking", tenantId, {
        source: "spreadsheet", batchId: null,
        booking: {
          clients: [{ firstName: booking.first, lastName: booking.last, email: booking.email, phone: null }], projectName: null,
          eventTypeId: booking.type, eventType: booking.label, eventDate: booking.date, timezone: "America/Chicago", venueName: null, city: "Austin, TX",
          state: "BOOKED", packageName: booking.label, coverageMinutes: 90, photographers: 1, videographers: 0, currency: "USD",
          totalCents: booking.total, taxCents: 0, signedOn: day(-90), signerName: `${booking.first} ${booking.last}`, hasSignedCopy: false, payments: booking.paid, notes: null,
        },
      }, owner),
    );
  }
  const imported = await query("projects", tenantId);
  record("three bookings imported, booked", imported.length === 3 && imported.every((project) => project.state === "BOOKED"), imported.map((project) => `${project.name}:${project.state}`).join(", "));
  // Imported bookings stay quiet: the schedulers that write to clients pass them by.
  await planningAndReminders();
  async function planningAndReminders() {
    await sweepEventReminders(db, new Date());
    await lifecycleMessageScheduler.run({});
    await finalInvoiceScheduler.run({});
    await finalDetailsScheduler.run({});
  }
  const clientEmails = (await query("emailJobs", tenantId)).filter((job) => bookings.some((booking) => String(job.recipient ?? "").includes(booking.email) || job.projectId && imported.some((project) => project.id === job.projectId)));
  record("imported bookings stay quiet: nothing to their clients", clientEmails.length === 0, clientEmails.map((job) => job.type).join(", ") || "no client email");
  const drafts = (await query("aiActions", tenantId)).filter((row) => imported.some((project) => project.id === row.projectId));
  record("and nothing drafted for them either", drafts.length === 0, drafts.map((row) => row.id).join(", ") || "none");

  // A forwarded inquiry on day one.
  const capture = await attempt("forwarded inquiry", () =>
    captureInquiry({
      db, tenantId, route: "forward", providerMessageId: `<uat-${run}@mail.test>`, now: new Date().toISOString(),
      email: {
        from: `uat-ortiz-${run}@studiohub.test`, fromName: "Dani Ortiz", replyTo: null, subject: "Family photos this fall?",
        text: "Hi! We'd love a family session in late October, four of us plus the dog, at Zilker Park if possible. What do you charge? Thanks, Dani",
        html: null, studioAddresses: [owner],
      },
    }),
  );
  record("it becomes an inquiry the studio sees", Boolean(capture?.leadId), `${capture?.outcome} lead ${capture?.leadId ?? "-"} job ${capture?.projectId ?? "-"}`);

  // "Cue's first two weeks": day 2's email.
  const subscription = await db.doc(`subscriptions/${tenantId}`).get();
  await queueTrialSeries(db, subscription, Date.now());
  const trialEmail = (await query("emailJobs", tenantId)).find((job) => String(job.type).startsWith("trial_cue_"));
  record("the trial series sends day 2's email", trialEmail?.type === "trial_cue_so_far", trialEmail ? String(trialEmail.type) : "none");
}

// ── Summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((row) => !row.ok);
console.log(`\nTALLY ${results.length - failed.length} pass, ${failed.length} fail`);
for (const row of failed) console.log(`  FAIL [${row.journey}] ${row.step} — ${row.detail}`);
process.exitCode = failed.length;
