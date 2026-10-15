/* eslint-disable @typescript-eslint/ban-ts-comment -- see the next line. */
// @ts-nocheck -- an Admin SDK + HTTP harness run through tsx; it reads untyped Firestore documents. Not part of the app.
/**
 * A job kind's walk (docs/new-job-kinds-execution-plan-2026-10-15.md Phase 0;
 * docs/adding-a-job-kind-playbook.md step 10): each trade the kind's fixture
 * lists (scripts/uat/kind-fixtures.mts) offers the kind on its inquiry form,
 * takes the honoree's event from a public inquiry to booked, sends (or fails
 * to send) the trade's form for the kind, lays out the night / the chairs /
 * the checklist from it, and the client's portal and emails are read back for
 * the words they must never read. Through StudioCue's own command functions
 * (HTTP, real emulator ID tokens), the app's client portal route and its
 * schedulers (in-process), against the Firebase emulator.
 *
 *   firebase emulators:start --project studiohub-dev          (another shell)
 *   npm run dev (live data mode, pointed at the same emulator) (another shell)
 *   set -a; . functions/.env.local; set +a
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     npx tsx scripts/uat/kind-walk.mts --kind mitzvah
 *
 * Every line prints PASS or FAIL with what was read back; the exit code is the
 * number of failures.
 */
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { KIND_FIXTURES, type Trade } from "./kind-fixtures.mts";

const kindArg = process.argv.indexOf("--kind");
const KIND = kindArg >= 0 ? String(process.argv[kindArg + 1] ?? "") : "mitzvah";
const F = KIND_FIXTURES[KIND];
if (!F) throw new Error(`No fixture for kind "${KIND}" in scripts/uat/kind-fixtures.mts (have: ${Object.keys(KIND_FIXTURES).join(", ")}).`);

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
function note(step: string, detail: string) {
  console.log(`NOTE  [${journey}] ${step} — ${detail}`);
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

// ── In-process workers, schedulers and the pure planners ────────────────────
const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
const { planningFormScheduler } = await import(`${REPO}/functions/src/planning/planning-form-scheduler.ts`);
const { normaliseInquiryFormConfig } = await import(`${REPO}/functions/src/intake/inquiry-form-config.ts`);
const { starterAgreementFor, BEAUTY_STARTER_AGREEMENT, PLANNER_STARTER_AGREEMENT } = await import(`${REPO}/features/contracts/sample.ts`);
const { vocab, journeyProfile } = await import(`${REPO}/features/job-kinds/job-kinds.ts`);

/** The words this kind's client must never read (the fixture's). */
const FORBIDDEN = F.forbidden;
const COUPLE_WORD = F.coupleWord;
const EVENT = new RegExp(F.eventPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const KIND_WORD = new RegExp(F.word, "i");
/** Whether the kind books on a signed agreement (journeyProfile(kind).agreement); a family session's does not. */
const HAS_AGREEMENT = journeyProfile(KIND).agreement;
/** What a family whose kind has no agreement must never be asked for. */
const AGREEMENT_ASK = /\b(agreements?|contracts?|deposits?|retainers?|e-?sign\w*)\b/i;
/** An email's words without its links. */
const words = (text: string) => text.replace(/https?:\/\/\S+/g, "");
const hit = (pattern: RegExp, text: string) => {
  const match = pattern.exec(text);
  if (!match) return "clean";
  const at = match.index;
  return `"${match[0]}" in …${text.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, " ")}…`;
};
/** Every string value in a JSON-ish thing, keys left out. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) strings(entry, out);
  else if (value && typeof value === "object") for (const entry of Object.values(value)) strings(entry, out);
  return out;
}

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
async function email(tenantId: string, type: string, projectId?: string) {
  const jobs = (await query("emailJobs", tenantId, { type })).filter((job) => !projectId || job.projectId === projectId);
  const job = jobs.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0];
  if (!job) return null;
  await drain("emailJobs", job.id);
  const message = await data(`messages/${job.id}`);
  return { job: (await data(`emailJobs/${job.id}`)) ?? job, subject: String(message?.subject ?? ""), text: String(message?.sentText ?? ""), recipient: String(message?.recipient ?? ""), id: job.id };
}

// ── Per trade ──────────────────────────────────────────────────────────────
const ROLE: Record<Trade, string> = { dj: "dj", makeup: "makeup_artist", hair: "hair_stylist", planner: "coordinator" };
function agreementFor(trade: Trade): string {
  if (trade === "planner") {
    return String(PLANNER_STARTER_AGREEMENT)
      .replace("[If you do, say from whom and how much.]", "")
      .replace("[your overtime rate]", "$75")
      .replace("[your travel area]", "30 miles")
      .replace("[your travel rate]", "$0.70 a mile")
      .replace("[Replace with your own cancellation and rescheduling terms.]", "The Client may cancel in writing; payments made to date are kept by the Planner.")
      .replace("[Replace with your own terms.]", "The Planner's liability is limited to the fees paid.");
  }
  if (trade === "dj") {
    return starterAgreementFor("dj").body
      .replace(/\[Replace with your own cancellation[^\]]*\]/, "The deposit is non-refundable. A new date within a year can be arranged once.")
      .replace(/\[Replace with your own terms on power[^\]]*\]/, "The venue provides two 20-amp outlets within 25 feet of the setup.")
      .replace(/\[Replace with your own terms\.\]/, "The Studio's liability is limited to the fees paid.");
  }
  return String(BEAUTY_STARTER_AGREEMENT)
    .replace(/\[Replace with your booking minimum[^\]]*\]/, "A minimum of four people applies. After the final headcount, people can be added but not taken off.")
    .replace(/\[Replace with what you need on the day[^\]]*\]/, "Please provide a table and chair near a window and two outlets.")
    .replace(/\[Replace with your trial terms[^\]]*\]/, "The trial is $150 and comes off the balance.")
    .replace(/\[Replace with your terms on allergies[^\]]*\]/, "The Client tells the Studio about any allergies before the day.")
    .replace(/\[Replace with your cancellation terms[^\]]*\]/, "The deposit is non-refundable.")
    .replace(/\[Replace with your own terms\.\]/, "The Studio's liability is limited to the fees paid.");
}

/** A value for a required form field a family would give. */
function fillField(field, eventDate: string) {
  return field.type === "date" ? eventDate
    : field.type === "time" ? "18:00"
    : field.type === "datetime" ? `${eventDate}T18:00`
    : ["radio", "select", "choice", "single_select"].includes(field.type) ? field.options?.[0]
    : field.type === "multi_select" ? [field.options?.[0]].filter(Boolean)
    : ["yes_no", "boolean", "checkbox", "acknowledgement"].includes(field.type) ? true
    : field.type === "number" ? 120
    : /email/.test(field.type) ? "family@studiohub.test"
    : /phone/.test(field.type) ? "201-555-0177"
    : F.fillerText;
}

/** The words of an agreement block: its `text` runs only, not its types or field keys. */
function textOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const entry of value) textOf(entry, out);
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "text" && typeof entry === "string") out.push(entry);
      else if (key === "label" || key === "value") { if (typeof entry === "string") out.push(entry); }
      else textOf(entry, out);
    }
  }
  return out;
}

/** Text of an agreement's blocks from the first heading matching `from` to the next heading matching `until`. */
function blockText(blocks: unknown[], from: RegExp, until?: RegExp): string {
  const start = blocks.findIndex((block) => block?.type === "heading" && from.test(textOf(block).join(" ")));
  if (start < 0) return "";
  const rest = blocks.slice(start + 1);
  const end = until ? rest.findIndex((block) => block?.type === "heading" && until.test(textOf(block).join(" "))) : -1;
  return [blocks[start], ...(end < 0 ? rest : rest.slice(0, end))].map((block) => textOf(block).join(" ")).join("\n");
}

async function walk(trade: Trade) {
  journey = trade;
  const T = F.trades[trade];
  const FORM = T.form;
  const name = T.studioName;
  const owner = `uat-${KIND}-${trade}-${run}@studiohub.test`;
  await account(owner, `${name} owner`);
  const created = await post("tenantOnboardingCommand", { businessName: name, legalName: `${name} LLC`, timezone: "America/New_York", currency: "USD", trade }, owner);
  const tenantId = String(created.tenantId);
  await db.doc(`subscriptions/${tenantId}`).set({ status: "trialing", checkoutRequired: false, currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000).toISOString() }, { merge: true });
  tokens.delete(owner);
  const tenant = await data(`tenants/${tenantId}`);
  record("studio onboarded", tenant?.trade === trade, `${name}: trade ${tenant?.trade}, timeline ${JSON.stringify(tenant?.planningTimeline ?? {})}`);

  // ── 1. The inquiry form offers the kind ──
  const before = await data(`leadCaptureSettings/${tenantId}`);
  const config = normaliseInquiryFormConfig(before?.inquiryForm ?? null);
  const plain = { ...config } as Partial<typeof config> & Pick<typeof config, "eventTypes">;
  delete plain.updatedAt;
  delete plain.updatedBy;
  plain.eventTypes = [
    ...plain.eventTypes.filter((type) => type.id !== F.eventType.id),
    { id: F.eventType.id, label: F.eventType.label, kind: KIND, eventDate: "required", city: "required", venue: true, guests: true, coi: true },
  ];
  const saved = await attempt(`1. setInquiryForm with a ${F.eventType.label} type`, () => command("crmCommand", "setInquiryForm", tenantId, { config: plain }, owner));
  if (!saved) return;
  const templates = await query("questionnaireTemplates", tenantId);
  const kindForms = templates.filter((template) => template.eventTypeId === F.eventType.id);
  const own = templates.find((template) => template.recommendedId === FORM);
  record(
    `1. the trade's ${F.word} form (${FORM}) is copied in`,
    Boolean(own) && own.status === "active",
    `${F.word} forms: ${kindForms.map((template) => `${template.recommendedId} "${template.name}"`).join(", ") || "none"}`,
  );
  record(
    `1. only this trade's ${F.word} forms are copied (no photographer details/shot list)`,
    kindForms.every((template) => template.recommendedId === FORM),
    kindForms.map((template) => template.recommendedId).join(", ") || "none",
  );
  const after = await data(`leadCaptureSettings/${tenantId}`);
  const byKind = after?.inquiryEventFormByKind?.[KIND] ?? null;
  // Only a `${kind}-details` form (the photographer's) becomes the inquiry's event form.
  record(
    `1. inquiryEventFormByKind.${KIND} left unset for a vendor (its form is not ${KIND}-details)`,
    byKind === null,
    `byKind.${KIND} ${JSON.stringify(byKind)}; inquiryEventForm ${JSON.stringify(after?.inquiryEventForm ?? null)}`,
  );
  // Copying again must not duplicate.
  await attempt("1. saving the form again", () => command("crmCommand", "setInquiryForm", tenantId, { config: plain }, owner));
  const again = (await query("questionnaireTemplates", tenantId)).filter((template) => template.eventTypeId === F.eventType.id);
  record("1. saving again copies nothing twice", again.length === kindForms.length, `${again.length} ${F.word} forms`);

  // Studio basics: hours, QuickBooks (mock), the agreement, a package for the kind.
  await command("bookingCommand", "setConsultationSettings", tenantId, {
    durationMinutes: 45, bufferMinutes: 15, mode: "open_default",
    windows: ["mon", "tue", "wed", "thu", "fri", "sat"].map((weekday) => ({ day: weekday, startMinute: 9 * 60, endMinute: 17 * 60 })),
    unavailableWindows: [], blockedDates: [], meetingFormats: ["in_person", "phone"], inPersonLocation: "The studio",
  }, owner).catch((error) => note("hours", String(error.message)));
  await db.doc(`integrationConnections/qbo_${tenantId}`).set({
    id: `qbo_${tenantId}`, tenantId, provider: "quickbooks", capability: "invoicing", status: "connected", mockMode: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  await db.doc(`tenants/${tenantId}`).set({ legalName: `${name} LLC` }, { merge: true });
  await attempt("agreement saved from the trade's starter", () =>
    command("bookingCommand", "saveAgreementTemplate", tenantId, { templateId: null, name: "Agreement", title: starterAgreementFor(trade).title, body: agreementFor(trade), customFields: [], makeDefault: true }, owner),
  );
  const pkg = await attempt(`${F.word} package`, () =>
    command("crmCommand", "createPackage", tenantId, {
      name: F.package.name, description: F.package.description, eventTypeId: F.eventType.id, eventTypeLabel: F.eventType.label,
      ...(trade === "planner" ? { planningScope: "full", paymentShape: "deposit_and_balance" } : {}),
      basePriceCents: 300000, currency: "USD", retainerRule: { type: "percentage", basisPoints: 2500 }, includedCoverageMinutes: 300,
      includedCoverage: [{ role: ROLE[trade], count: 1 }], includedDeliverables: F.package.deliverables, includedTravelArea: "Within 30 miles",
      addOns: [], addOnIds: [], taxRateBasisPoints: 0, terms: "Subject to the signed agreement.", active: true, publicVisible: true, displayOrder: 1, internalNotes: "",
    }, owner),
  );
  if (!pkg) return;

  // ── 2. A public inquiry for the honoree's event ──
  const eventDate = day(200);
  const clientEmail = `uat-${KIND}-${trade}-client-${run}@studiohub.test`;
  const customAnswers: Record<string, string> = {};
  for (const question of plain.questions ?? []) {
    if (!question.required) continue;
    if (question.eventTypeIds.length && !question.eventTypeIds.includes(F.eventType.id)) continue;
    customAnswers[question.id] = question.type === "choice" ? question.options[0] : question.type === "yes_no" ? "yes" : "About 120 guests";
  }
  const honoreePayload: Record<string, string> = F.honoree
    ? { honoreeName: F.honoree.name, ...(F.honoree.variantField && F.honoree.variant ? { [F.honoree.variantField]: F.honoree.variant } : {}) }
    : {};
  /** Whether a record (job, lead, portal payload) carries the fixture's honoree. */
  const hasHonoree = (row) => !F.honoree || (row?.honoreeName === F.honoree.name && (!F.honoree.variantField || row?.[F.honoree.variantField] === F.honoree.variant));
  const variantOf = (row) => (F.honoree?.variantField ? row?.[F.honoree.variantField] : "-");
  const inquiry = await attempt(`2. publicLeadIntake (${[F.honoree?.name, F.honoree?.variant].filter(Boolean).join(", ") || F.client.firstName})`, async () => {
    const response = await fetch(`${FUNCTIONS}/publicLeadIntake`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-studiohub-client-ip": `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({
        tenantSlug: tenant?.publicSlug, firstName: F.client.firstName, lastName: F.client.lastName, email: clientEmail, phone: "201-555-0142",
        eventType: F.eventType.label, eventTypeKey: F.eventType.id, ...honoreePayload,
        servicesRequested: ["other"], message: F.inquiry.message, consent: true,
        eventDate, city: F.inquiry.city, venue: F.inquiry.venue, estimatedGuestCount: F.inquiry.guests, customAnswers, honeypot: "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`publicLeadIntake: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
    const lead = await waitFor(() => data(`leads/${body.leadId}`), (value) => Boolean(value?.projectId));
    return { leadId: String(body.leadId), projectId: String(lead?.projectId ?? ""), lead };
  });
  if (!inquiry?.projectId) {
    if (inquiry) record("2. the inquiry became a job", false, "lead has no projectId");
    return;
  }
  const { projectId, leadId } = inquiry;
  let project = await data(`projects/${projectId}`);
  record(
    `2. the job is ${F.jobName}`,
    project?.eventKind === KIND && hasHonoree(project) && String(project?.name) === F.jobName,
    `eventKind ${project?.eventKind}, honoree ${project?.honoreeName}, type ${variantOf(project)}, name "${project?.name}", eventTypeId ${project?.eventTypeId}, eventType "${project?.eventType}"`,
  );
  if (F.honoree) record("2. the lead keeps the honoree", hasHonoree(inquiry.lead), `lead honoree ${inquiry.lead?.honoreeName}, type ${variantOf(inquiry.lead)}`);
  const studioWords = vocab(KIND, project);
  record("2. vocab(kind, job) names it", studioWords.yourEvent === F.yourEvent, `yourEvent "${studioWords.yourEvent}"`);
  // Cue's first reply, drafted in mock mode.
  await waitFor(() => data(`aiJobs/lead_intake_${leadId}`), Boolean, 8000);
  await drain("aiJobs", `lead_intake_${leadId}`);
  const reply = await waitFor(() => data(`aiActions/ai_reply_${leadId}`), (value) => Boolean(value), 8000);
  const replyBody = String(reply?.structuredOutput?.body ?? "");
  const aiJob = await data(`aiJobs/lead_intake_${leadId}`);
  record("2. Cue's first reply has no wedding words", Boolean(reply) && !FORBIDDEN.test(words(replyBody)), reply ? `${hit(FORBIDDEN, words(replyBody))} | subject "${reply?.structuredOutput?.subject ?? ""}"` : `no draft (aiJob ${aiJob?.status ?? "missing"} ${String(aiJob?.lastError ?? aiJob?.error ?? "").slice(0, 120)})`);
  if (reply) note("2. Cue's reply", replyBody.replace(/\s+/g, " ").slice(0, 300));
  if (reply && !HAS_AGREEMENT) record("2. Cue's first reply asks for no agreement or deposit", !AGREEMENT_ASK.test(words(replyBody)), hit(AGREEMENT_ASK, words(replyBody)));

  // ── 3. To booked ──
  // A trade whose call is required (a planner's discovery call) books it from the studio's link first.
  if (trade === "planner") {
    await attempt("3. discovery call booked from the link", async () => {
      await post("publicConsultationScheduling", { type: "create_link", tenantId, idempotencyKey: randomUUID(), input: { projectId, contactId: project.clientContactIds[0], mode: "in_person", purpose: "consultation" } }, owner);
      const invite = await email(tenantId, "consultation_invitation", projectId);
      const linkToken = tokenFrom(invite?.job?.actionUrl);
      const slots = await post("publicConsultationScheduling", { type: "availability", idempotencyKey: randomUUID(), input: { token: linkToken } });
      const slot = (slots.slots ?? [])[0];
      if (!slot) throw new Error("no openings");
      await post("publicConsultationScheduling", { type: "book", idempotencyKey: randomUUID(), input: { token: linkToken, startsAt: slot.startsAt } });
      record("3. the call invitation has no wedding words", invite !== null && !FORBIDDEN.test(words(`${invite.subject} ${invite.text}`)), invite ? `${invite.subject} | ${hit(FORBIDDEN, words(invite.text))}` : "no email");
    });
    project = await data(`projects/${projectId}`);
    note("3. after the call", `state ${project?.state}`);
  }
  const bookingStep = HAS_AGREEMENT
    ? "3. proposal/quote → accepted → agreement signed → retainer → booked"
    : `3. quote → accepted → paid (${journeyProfile(KIND).payment}) → booked, no agreement`;
  const booked = await attempt(bookingStep, async () => {
    const locked = await command("crmCommand", "selectPackage", tenantId, { projectId, packageId: String(pkg.packageId), selectedAddOns: [], mode: "replace", confirmReplace: false, discount: { type: "none" } }, owner);
    const draft = await command("proposalCommand", "create_draft", tenantId, {
      projectId, expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(), notes: null, termsSummary: "Subject to the signed agreement.", retainerDueDate: null, balanceDueDate: null,
    }, owner);
    const proposalId = String(draft.proposalId);
    await command("proposalCommand", "submit_for_approval", tenantId, { proposalId }, owner);
    await command("proposalCommand", "approve", tenantId, { proposalId }, owner);
    for (const job of (await query("pdfJobs", tenantId)).filter((job) => job.proposalId === proposalId)) await drain("pdfJobs", job.id);
    await command("proposalCommand", "send", tenantId, { proposalId }, owner);
    const sent = await email(tenantId, "proposal_sent", projectId);
    await account(clientEmail, `${F.client.firstName} ${F.client.lastName}`);
    await post("clientInvitationCommand", { type: "accept", idempotencyKey: randomUUID(), input: { token: tokenFrom(sent?.job?.actionUrl ?? sent?.job?.values?.actionUrl) } }, clientEmail);
    await portal("decide_proposal", { tenantId, projectId, proposalId, decision: "accepted", reason: null }, clientEmail);
    if (!HAS_AGREEMENT) {
      // bookWithoutAgreement (functions/src/booking/orchestration.ts): accepted → RETAINER_PENDING with the bill raised.
      const pending = await waitFor(() => data(`projects/${projectId}`), (value) => value?.state === "RETAINER_PENDING", 20000);
      const invoice = await waitFor(async () => (await query("invoiceReferences", tenantId, { projectId })).find((row) => row.kind === "retainer"), Boolean);
      await drainAll("providerJobs", tenantId);
      const proposal = await data(`proposals/${proposalId}`);
      await command("bookingCommand", "recordRetainerPayment", tenantId, { projectId, packageSnapshotId: String(locked.packageSnapshotId), paidAt: day(0), method: "card", reference: null, attestation: true }, owner);
      const bookedProject = await waitFor(() => data(`projects/${projectId}`), (value) => value?.state === "BOOKED", 30000);
      await drainAll("providerJobs", tenantId);
      return { proposalId, contract: null, prepared: null, booked: bookedProject, sent, pending, invoice, proposal };
    }
    await waitFor(() => data(`contractDrafts/${projectId}`), (value) => Boolean(value?.documentHash));
    await command("bookingCommand", "prepareContract", tenantId, { projectId, proposalId, overrides: {} }, owner).catch(() => undefined);
    const prepared = await data(`contractDrafts/${projectId}`);
    await command("bookingCommand", "sendContract", tenantId, { projectId, documentHash: prepared?.documentHash, studioSignerName: `${name} owner`, consent: true }, owner);
    const contract = (await query("contracts", tenantId, { projectId }))[0];
    await portal("sign_contract", {
      tenantId, projectId, contractId: contract.id, documentHash: contract.documentHash, typedName: `${F.client.firstName} ${F.client.lastName}`, consent: true, consentVersion: "esign-consent-v2",
      billingAddress: { line1: "14 Mill Lane", line2: null, city: "Montclair", region: "NJ", postalCode: "07042", country: "US" },
    }, clientEmail);
    await waitFor(async () => (await query("invoiceReferences", tenantId, { projectId })).find((invoice) => invoice.kind === "retainer"), Boolean);
    await drainAll("providerJobs", tenantId);
    await command("bookingCommand", "recordRetainerPayment", tenantId, { projectId, packageSnapshotId: String(locked.packageSnapshotId), paidAt: day(0), method: "card", reference: null, attestation: true }, owner);
    const bookedProject = await waitFor(() => data(`projects/${projectId}`), (value) => value?.state === "BOOKED", 30000);
    await drainAll("providerJobs", tenantId);
    return { proposalId, contract, prepared, booked: bookedProject, sent };
  });
  if (!booked) return;
  record("3. booked", booked.booked?.state === "BOOKED", `state ${booked.booked?.state}`);
  if (!HAS_AGREEMENT) {
    record("3. accepting moved the job straight to payment (RETAINER_PENDING), not CONTRACT_PENDING", booked.pending?.state === "RETAINER_PENDING", `state after accepting: ${booked.pending?.state}, nextAction "${booked.pending?.nextAction ?? ""}"`);
    const schedule = (booked.proposal?.paymentSchedule ?? []).map((line) => `${line.label} ${line.amountCents}`).join(" + ");
    const paidInFull = journeyProfile(KIND).payment === "paid_in_full";
    if (paidInFull) {
      record("3. the quote's schedule is one 'Payment in full' line", (booked.proposal?.paymentSchedule ?? []).length === 1 && booked.proposal.paymentSchedule[0]?.label === "Payment in full", schedule || "no schedule");
      const price = Number(booked.proposal?.paymentSchedule?.[0]?.amountCents ?? 0);
      record("3. the bill raised on accepting is the whole price (paidInFull)", booked.invoice?.paidInFull === true && Number(booked.invoice?.amountCents) === price && price > 0,
        `invoice paidInFull ${booked.invoice?.paidInFull}, amount ${booked.invoice?.amountCents}, schedule ${schedule}, project paymentShape ${booked.pending?.paymentShape ?? "(unset)"}`);
    }
    const drafts = await data(`contractDrafts/${projectId}`);
    const contracts = await query("contracts", tenantId, { projectId });
    record("3. no agreement was prepared or sent", !drafts && contracts.length === 0, `contractDrafts ${drafts ? "exists" : "none"}, contracts ${contracts.length}`);
    record("3. the quote email has no wedding words", booked.sent !== null && !FORBIDDEN.test(words(`${booked.sent?.subject} ${booked.sent?.text}`)), booked.sent ? `${booked.sent.subject} | ${hit(FORBIDDEN, words(booked.sent.text))}` : "no email");
    record("3. the quote email asks for no agreement or deposit", booked.sent !== null && !AGREEMENT_ASK.test(words(`${booked.sent?.subject} ${booked.sent?.text}`)), booked.sent ? hit(AGREEMENT_ASK, words(`${booked.sent.subject} ${booked.sent.text}`)) : "no email");
  } else {
  const blocks = booked.contract?.document?.blocks ?? [];
  const headings = blocks.filter((block) => block?.type === "heading").map((block) => textOf(block).join(" "));
  const scheduleA = blockText(blocks, /^Schedule A/, /^Schedule B/);
  const scheduleB = blockText(blocks, /^Schedule B/);
  record(`3. ${F.scheduleA}`, headings.includes(F.scheduleA), `headings: ${headings.slice(-4).join(" | ")}`);
  record(`3. ${F.scheduleB}`, headings.includes(F.scheduleB), scheduleB.slice(0, 160).replace(/\n/g, " / ") || "no Schedule B");
  const missingWording = T.scheduleB.filter((pattern) => !pattern.test(scheduleB));
  record(`3. Schedule B in the ${trade}'s own words`, scheduleB.length > 0 && missingWording.length === 0, missingWording.length ? `missing ${missingWording.join(", ")}` : "both terms in the trade's wording");
  record("3. no wedding words in Schedule A", Boolean(scheduleA) && !FORBIDDEN.test(scheduleA), scheduleA ? `${hit(FORBIDDEN, scheduleA)} | A: ${scheduleA.slice(0, 220).replace(/\n/g, " / ")}` : "no Schedule A");
  record("3. no wedding words in Schedule B", Boolean(scheduleB) && !FORBIDDEN.test(scheduleB), hit(FORBIDDEN, scheduleB));
  const body = blocks.map((block) => textOf(block).join(" ")).join("\n");
  record("3. no wedding words anywhere in the agreement the family signs", !FORBIDDEN.test(body), hit(FORBIDDEN, body));
  record(`3. the agreement names the ${F.eventPhrase}`, EVENT.test(body), EVENT.test(body) ? `says ${F.eventPhrase}` : `event type reads: ${hit(KIND_WORD, body)}`);
  record("3. the proposal/quote email has no wedding words", booked.sent !== null && !FORBIDDEN.test(words(`${booked.sent?.subject} ${booked.sent?.text}`)), booked.sent ? `${booked.sent.subject} | ${hit(FORBIDDEN, words(booked.sent.text))}` : "no email");
  }

  // ── 4. The planning form ──
  const formsOf = async () => {
    const responses = await query("questionnaireResponses", tenantId, { projectId });
    const all = await query("questionnaireTemplates", tenantId);
    return responses.map((response) => ({ ...response, recommendedId: all.find((template) => template.id === response.templateId)?.recommendedId ?? null }));
  };
  const atBooking = await waitFor(formsOf, (rows) => rows.length > 0, 6000);
  const describe = (rows) => rows.map((row) => `${row.recommendedId ?? row.templateId} "${row.templateName}" (${row.status}, source ${row.source ?? "-"})`).join(", ") || "none";
  const bookingSendsForm = trade !== "planner";
  if (bookingSendsForm) {
    record(`4. at booking the ${FORM} form goes out (one-form trade, formAtBooking)`, atBooking.some((row) => row.recommendedId === FORM), describe(atBooking));
  } else {
    record("4. a planner sends nothing at booking", atBooking.length === 0, describe(atBooking));
  }
  record(`4. no wedding form was sent for the ${F.word}`, !atBooking.some((row) => F.foreignForms.test(String(row.recommendedId ?? ""))), describe(atBooking));
  // Past the form date (journeyProfile(kind).detailsFormDaysBefore).
  note("4. form date", `detailsFormDaysBefore ${journeyProfile(KIND).detailsFormDaysBefore}; moving the job to ${F.formDueDaysOut} days out`);
  await db.doc(`projects/${projectId}`).set({ eventDate: day(F.formDueDaysOut) }, { merge: true });
  await planningFormScheduler.run({});
  const afterSweep = await formsOf();
  const mine = afterSweep.find((row) => row.recommendedId === FORM);
  // A studio on "remind" (the default, planning-timeline.ts) is reminded, not auto-sent: by design the form
  // has then either gone at booking or waits for the studio's "Send the form".
  const formSend = tenant?.planningTimeline?.formSend === "auto" ? "auto" : "remind";
  const sentAtBooking = atBooking.some((row) => row.recommendedId === FORM);
  record(`4. by the form date (${F.formDueDaysOut} days out) the job has its ${FORM} (or it went at booking, or the studio is on "remind")`,
    Boolean(mine) || sentAtBooking || formSend === "remind",
    `${describe(afterSweep)}; timeline formSend ${tenant?.planningTimeline?.formSend ?? "(default remind)"}; sent at booking ${sentAtBooking}`);
  let response = mine;
  if (!response) {
    // What the studio would do by hand: "Send the form" with its form for the kind.
    const sentByHand = await attempt(`4. (fallback) the studio sends the ${F.word} form by hand`, () => command("planningCommand", "assignQuestionnaire", tenantId, { projectId, templateId: own.id }, owner));
    if (sentByHand) response = (await formsOf()).find((row) => row.recommendedId === FORM);
    note("4. fallback", response ? `assigned by hand: ${response.templateName}` : "still no form");
  }
  const request = await email(tenantId, "questionnaire_request", projectId);
  record("4. the form's email has no wedding words", request !== null && !FORBIDDEN.test(words(`${request.subject} ${request.text}`)), request ? `${request.subject} | ${hit(FORBIDDEN, words(request.text))}` : "no email");

  // ── 5. The trade's own plan from the form ──
  if (response) {
    const template = await data(`questionnaireTemplates/${response.templateId}`);
    const sections = response.templateSnapshot?.sections ?? template?.sections ?? [];
    const given: Record<string, unknown> = T.answers;
    const answers: Record<string, unknown> = { ...given };
    for (const section of sections) for (const field of section.fields ?? []) if (field.required && answers[field.id] === undefined) answers[field.id] = fillField(field, day(F.formDueDaysOut));
    const savedForm = await attempt("5. the family fills in and sends the form", () =>
      command("planningCommand", "saveQuestionnaire", tenantId, { responseId: response.id, projectId, answers, submit: true }, clientEmail),
    );
    const back = await data(`questionnaireResponses/${response.id}`);
    record("5. the form is submitted", Boolean(savedForm) && back?.status === "submitted", `status ${back?.status}`);
    const stored = back?.answers ?? answers;

    await T.plan({
      trade, stored, dayPlan: journeyProfile(KIND).dayPlan ?? null, record, note, hit, fixture: F,
      // Planner: the checklist (functions/src/planning/planning-checklist-sync.ts), written at booking.
      checklist: async () => {
        const tasks = await waitFor(
          async () => (await query("tasks", tenantId, { projectId })).filter((task) => String(task.id).startsWith(`planning_${projectId}_`)),
          (rows) => rows.length > 0,
          15000,
        );
        return { tasks, keys: tasks.map((task) => String(task.id).slice(`planning_${projectId}_`.length)) };
      },
    });
  } else {
    record("5. the trade's plan", false, `no ${F.word} form on the job to fill in`);
  }

  // ── 6. The family's portal and emails ──
  const list = await attempt("6. portal: projects", () => portal("projects", { tenantId }, clientEmail));
  const listed = (list?.projects ?? []).find((row) => row.id === projectId);
  record(`6. portal lists the job as the ${F.eventPhrase}`, Boolean(listed) && EVENT.test(String(listed?.name)), listed ? `name "${listed.name}", eventType "${listed.eventType}"` : "not listed");
  const view = await attempt("6. portal: project", () => portal("project", { tenantId, projectId }, clientEmail));
  if (view) {
    const words6 = vocab(view.eventKind, view);
    record(`6. portal says it is a ${F.word}`, view.eventKind === KIND, `eventKind ${view.eventKind}, eventType "${view.eventType}", name "${view.name}"`);
    record(`6. portal payload carries the honoree so the page can say "${F.yourEvent}"`, words6.yourEvent === F.yourEvent,
      `vocab(eventKind, portal payload).yourEvent = "${words6.yourEvent}" (payload honoreeName ${JSON.stringify(view.honoreeName)}, ${F.honoree?.variantField ?? "variant"} ${JSON.stringify(F.honoree?.variantField ? view[F.honoree.variantField] : null)})`);
    const portalText = strings(view).join("\n");
    // A kind whose variant is the generic occasionVariant (mitzvahType reaches the page through yourEvent above).
    if (F.honoree?.variantField === "occasionVariant") record(`6. portal payload carries ${F.honoree.variantField}`, view[F.honoree.variantField] === F.honoree.variant, `${F.honoree.variantField} ${JSON.stringify(view[F.honoree.variantField])}`);
    if (!HAS_AGREEMENT) note("6. portal agreement/deposit words", hit(AGREEMENT_ASK, portalText));
    record("6. portal payload has no wedding words", !FORBIDDEN.test(portalText), hit(FORBIDDEN, portalText));
    note("6. portal next step", JSON.stringify({ planningForm: view.planningForm ?? null, nextAction: view.nextAction ?? view.next ?? null }).slice(0, 300));
  }
  const forms = await attempt("6. portal: forms", () => portal("records", { tenantId, projectId, collection: "questionnaireResponses" }, clientEmail));
  if (forms) {
    const formText = strings((forms.records ?? []).map((row) => ({ name: row.templateName, sections: row.templateSnapshot?.sections ?? row.sections ?? [] }))).join("\n");
    record("6. the forms the family sees have no wedding words", !FORBIDDEN.test(formText), `${(forms.records ?? []).map((row) => row.templateName).join(", ")} | ${hit(FORBIDDEN, formText)}`);
  }
  // Every email the family got, rendered by the mock worker.
  await drainAll("emailJobs", tenantId);
  const jobs = (await query("emailJobs", tenantId)).filter((job) => job.projectId === projectId || job.leadId === leadId);
  const toFamily = [];
  for (const job of jobs) {
    const message = await data(`messages/${job.id}`);
    if (!message) continue;
    if (String(message.recipient ?? "").toLowerCase() !== clientEmail) continue;
    toFamily.push({ type: job.type, subject: String(message.subject ?? ""), text: words(`${message.subject ?? ""}\n${message.sentText ?? ""}`) });
  }
  record("6. the family's emails were rendered", toFamily.length > 0, toFamily.map((row) => row.type).join(", ") || `none (${jobs.length} jobs: ${jobs.map((job) => `${job.type}:${job.status}`).join(", ")})`);
  for (const row of toFamily) {
    record(`6. email ${row.type} has no wedding words`, !FORBIDDEN.test(row.text), `"${row.subject}" | ${hit(FORBIDDEN, row.text)}`);
    if (COUPLE_WORD.test(row.text)) note(`6. email ${row.type} says couple`, hit(COUPLE_WORD, row.text));
    if (!HAS_AGREEMENT) record(`6. email ${row.type} asks for no agreement or deposit`, !AGREEMENT_ASK.test(row.text), `"${row.subject}" | ${hit(AGREEMENT_ASK, row.text)}`);
  }
  const named = toFamily.filter((row) => EVENT.test(row.text));
  note(`6. emails that name the ${F.eventPhrase}`, named.map((row) => row.type).join(", ") || "none");
}

console.log(`Walking kind "${KIND}" for ${Object.keys(F.trades).join(", ")}`);
for (const trade of Object.keys(F.trades) as Trade[]) {
  try {
    await walk(trade);
  } catch (error) {
    record("walk", false, `threw: ${String(error?.message ?? error).slice(0, 300)}`);
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((row) => !row.ok);
console.log(`\nTALLY ${results.length - failed.length} pass, ${failed.length} fail`);
for (const row of failed) console.log(`  FAIL [${row.journey}] ${row.step} — ${row.detail}`);
process.exitCode = failed.length;
