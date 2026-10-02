/**
 * The dateless inquiry, walked against the real functions in the emulator.
 *
 * A couple emails the studio with no date; the studio forwards it. The walk
 * makes the lead the way the forwarding path does (intake/capture.ts), mints
 * the couple's /i/<token> link the way the first reply does (withInquiryLink),
 * then plays the couple's page over HTTP, action by action, exactly as
 * components/inquiries/couple-inquiry-page.tsx calls publicConsultationScheduling:
 *
 *   preview → date (inquiry_details) → form → save part → reload → submit
 *   → times → book → move the call
 *
 * and checks Firestore after each step: the date makes the job, the answers
 * are a questionnaireResponses record on it (source inquiry_page), the call
 * waits for the form (INQUIRY_FORM_REQUIRED), and the AI read of the form is
 * queued when the call is booked — not when the form is sent — and only once.
 *
 * Studio setup goes through the real commands as the seeded owner:
 * bookingCommand setConsultationSettings and planningCommand
 * setInquiryEventForm.
 *
 * Emulator only. From the repo root, with the emulators up and seeded:
 *   cd functions && npm run build && cd ..
 *   firebase emulators:start --project studiohub-dev --only auth,firestore,functions,storage
 *   set -a; . ./.env.local; set +a
 *   SEED_WEDDING_PACKAGE_CENTS=650000 npx tsx scripts/seed.ts
 *   npx tsx scripts/uat/inquiry-form-walk.mts
 * Prints PASS/FAIL per check and exits non-zero on any failure.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const REPO = process.cwd();
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Refusing to run without emulator hosts (FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST).");
}
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "studiohub-dev";
if (PROJECT.includes("prod")) throw new Error("Refusing to run against a production project id.");
const FUNCTIONS = (process.env.FUNCTIONS_HTTPS_ORIGIN ?? `http://127.0.0.1:5001/${PROJECT}/us-east4`).replace(/\/$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(FUNCTIONS)) throw new Error(`Refusing a non-emulator functions origin: ${FUNCTIONS}`);
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const password = process.env.SEED_DEMO_PASSWORD;
if (!password) throw new Error("SEED_DEMO_PASSWORD is required (set -a; . ./.env.local; set +a).");

// The functions package's own firebase-admin, so the helpers below share the
// app this script initialises.
const require = createRequire(`${REPO}/functions/package.json`);
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const { captureInquiry } = await import(`${REPO}/functions/lib/intake/capture.js`);
const { withInquiryLink } = await import(`${REPO}/functions/lib/intake/inquiry-link.js`);

/* ── Reporting ─────────────────────────────────────────────────────────── */

let failures = 0;
let passes = 0;
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) {
    passes += 1;
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}
const step = (title: string) => console.log(`\n── ${title}`);

/* ── Calls ─────────────────────────────────────────────────────────────── */

type Reply = { status: number; body: Record<string, unknown> };

async function post(fn: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const response = await fetch(`${FUNCTIONS}/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  return { status: response.status, body: parsed };
}

/** The couple's page: no sign-in, the token is the credential. */
const couple = (type: string, input: Record<string, unknown>) =>
  post("publicConsultationScheduling", { type, idempotencyKey: randomUUID(), input });

async function ownerToken(): Promise<string> {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@studiohub.test", password, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken?: string; error?: unknown };
  if (!body.idToken) throw new Error(`Owner sign-in failed: ${JSON.stringify(body.error)}`);
  return body.idToken;
}

/* ── The studio ────────────────────────────────────────────────────────── */

const tenants = await db.collection("tenants").where("slug", "==", "alder-and-muse").limit(1).get();
const tenantId: string = tenants.docs[0]?.id ?? process.argv[2];
if (!tenantId) throw new Error("No seeded tenant (alder-and-muse). Run scripts/seed.ts first.");
const now = () => new Date().toISOString();

step("Studio setup through the real commands");
const idToken = await ownerToken();
const studio = (fn: string, type: string, input: Record<string, unknown>) =>
  post(fn, { type, tenantId, idempotencyKey: `walk_${randomUUID()}`, input }, { authorization: `Bearer ${idToken}` });

const allWeek = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((day) => ({ day, startMinute: 9 * 60, endMinute: 17 * 60 }));
const hours = await studio("bookingCommand", "setConsultationSettings", {
  durationMinutes: 30,
  bufferMinutes: 0,
  mode: "closed_default",
  windows: allWeek,
  unavailableWindows: [],
  blockedDates: [],
  meetingFormats: ["zoom", "phone"],
  inPersonLocation: null,
});
check("setConsultationSettings accepted", hours.status === 200, hours);
const consultationSettings = await db.doc(`consultationSettings/${tenantId}`).get();
check("consultationSettings written for the tenant", consultationSettings.get("tenantId") === tenantId);

const templates = await db.collection("questionnaireTemplates").where("tenantId", "==", tenantId).get();
const template = templates.docs.find((document: { get: (field: string) => unknown }) => document.get("name") === "Wedding Planning Questionnaire");
if (!template) throw new Error("The seeded Wedding Planning Questionnaire is missing.");
const chosen = await studio("planningCommand", "setInquiryEventForm", { templateId: template.id });
check("setInquiryEventForm accepted", chosen.status === 200, chosen);
const captureSettings = await db.doc(`leadCaptureSettings/${tenantId}`).get();
check(
  "leadCaptureSettings.inquiryEventForm names the seeded template",
  (captureSettings.get("inquiryEventForm") as { templateId?: string } | undefined)?.templateId === template.id,
  captureSettings.get("inquiryEventForm"),
);

/* ── The inquiry, the way a forwarded email makes it ──────────────────── */

step("A dateless wedding inquiry, forwarded from the studio's inbox");
const tag = randomUUID().slice(0, 8);
const coupleEmail = `walk-${tag}@example.com`;
const captured = await captureInquiry({
  db,
  tenantId,
  route: "forward",
  providerMessageId: `walk-${tag}`,
  now: now(),
  email: {
    from: "studio@alderandmuse.example",
    fromName: "Alder & Muse",
    replyTo: null,
    subject: "Fwd: Wedding photography?",
    text: [
      "---------- Forwarded message ---------",
      `From: Priya Shah <${coupleEmail}>`,
      "Date: Thu, Oct 1, 2026 at 9:12 AM",
      "Subject: Wedding photography?",
      "To: <studio@alderandmuse.example>",
      "",
      "Hi there,",
      "Jordan and I just got engaged and are planning our wedding for sometime next year — we haven't settled on a date yet. We love your work and are looking for a wedding photographer. Do you have packages you could share?",
      "",
      "Priya",
    ].join("\n"),
    html: null,
    studioAddresses: ["studio@alderandmuse.example"],
  },
});
check("capture made a new inquiry", captured.outcome === "lead_created", captured);
check("no job yet: there is no date", captured.projectId === null, captured);
const leadId: string = captured.leadId;
let lead = await db.doc(`leads/${leadId}`).get();
check("lead is dateless", !lead.get("eventDate"), lead.get("eventDate"));
check("lead has no projectId", !lead.get("projectId"), lead.get("projectId"));
check("lead reads as a wedding", /wedding/i.test(String(lead.get("eventTypeLabel"))), lead.get("eventTypeLabel"));

step("The first reply carries the couple's link");
const reply = await withInquiryLink(db, {
  tenantId,
  leadId,
  body: "Hi Priya,\n\nThank you so much for reaching out!\n\nWarmly,\nAlder & Muse",
  now: now(),
});
check("reply is linked", reply.linked === true, reply);
check(
  "reply doesn't promise two minutes when the form comes first",
  reply.body.includes("Tell us about your day and pick a time to talk:") && !reply.body.includes("two minutes"),
  reply.body,
);
const token = /\/i\/([A-Za-z0-9_-]+)/.exec(reply.body)?.[1] ?? "";
const linkDoc = await db.doc(`inquiryLinks/${leadId}`).get();
check("the token in the reply is the one stored on inquiryLinks", token && linkDoc.get("token") === token);

/* ── The couple's page ─────────────────────────────────────────────────── */

step("1. inquiry_preview — the page opens");
let preview = await couple("inquiry_preview", { token });
check("preview 200", preview.status === 200, preview);
const eventForm = preview.body.eventForm as { name?: string; status?: string; requiresDate?: boolean } | null;
check("the page offers the event form", Boolean(eventForm), preview.body);
check("…and asks for the date first", eventForm?.requiresDate === true, eventForm);
check("event form not started", eventForm?.status === "not_started", eventForm);
check("studio takes bookings", preview.body.takesBookings === true, preview.body.takesBookings);
check("eventDate is listed as missing", (preview.body.missing as string[]).includes("eventDate"), preview.body.missing);
check("nothing booked", preview.body.booked === null);

step("2. Before the date: the form and the call both wait");
const earlyForm = await couple("inquiry_form", { token });
check("inquiry_form refused with EVENT_DATE_REQUIRED", earlyForm.status === 400 && earlyForm.body.error === "EVENT_DATE_REQUIRED", earlyForm);
const earlySlots = await couple("inquiry_availability", { token });
const earlySlot = (earlySlots.body.slots as Array<{ startsAt: string }> | undefined)?.[0]?.startsAt;
const earlyBook = await couple("inquiry_book", { token, startsAt: earlySlot ?? new Date(Date.now() + 86400000).toISOString(), format: "zoom" });
check("inquiry_book refused with EVENT_DATE_REQUIRED", earlyBook.status === 400 && earlyBook.body.error === "EVENT_DATE_REQUIRED", earlyBook);

step("3. inquiry_details — the date makes the job");
const eventDate = new Date(Date.now() + 240 * 86400000).toISOString().slice(0, 10);
const details = await couple("inquiry_details", {
  token,
  details: { eventDate, partnerName: "Jordan Lee", venue: "Oak Hill Barn", city: "Concord", estimatedGuestCount: 120 },
});
check("details 200", details.status === 200, details);
check("details say a job now exists", details.body.hasJob === true, details.body);
lead = await db.doc(`leads/${leadId}`).get();
const projectId = String(lead.get("projectId") ?? "");
check("lead gets a projectId", Boolean(projectId), lead.data());
check("lead holds the date", lead.get("eventDate") === eventDate, lead.get("eventDate"));
const project = projectId ? await db.doc(`projects/${projectId}`).get() : null;
check("the job exists", Boolean(project?.exists));
check("the job is the studio's", project?.get("tenantId") === tenantId, project?.get("tenantId"));
check("the job carries the date", project?.get("eventDate") === eventDate, project?.get("eventDate"));
check("the job starts at LEAD", project?.get("state") === "LEAD", project?.get("state"));

step("4. inquiry_preview again — the form is open now");
preview = await couple("inquiry_preview", { token });
const formAfterDate = preview.body.eventForm as { status?: string; requiresDate?: boolean } | null;
check("form no longer waits on the date", formAfterDate?.requiresDate === false, formAfterDate);
check("form still not started", formAfterDate?.status === "not_started", formAfterDate);

step("5. inquiry_form — load the questions");
const loaded = await couple("inquiry_form", { token });
check("form 200", loaded.status === 200, loaded);
type Field = { id: string; label: string; type: string; required: boolean; locked: boolean; options: string[] };
const sections = (loaded.body.sections ?? []) as Array<{ id: string; fields: Field[] }>;
const fields = sections.flatMap((section) => section.fields);
check("the couple sees the template's questions", fields.length > 5, fields.length);
check("no file questions on the public page", !fields.some((field) => field.type === "file"));
check("form status not_started", loaded.body.status === "not_started", loaded.body.status);
const startedWith = (loaded.body.answers ?? {}) as Record<string, unknown>;
const byLabel = (label: string) => fields.find((field) => field.label === label)?.id ?? "";
check("the date step's partner name is already on the form", startedWith[byLabel("Second partner's full name")] === "Jordan Lee", startedWith);
check("…and the guest count", startedWith[byLabel("Expected guest count")] === "120", startedWith);
check("…and their own name", startedWith[byLabel("First partner's full name")] === "Priya Shah", startedWith);
// "I'm the bride / I'm the groom" only on a form that asks by role; this one doesn't.
check("no 'Which are you?' on a form that asks by partner, not role", loaded.body.roleChoices == null, loaded.body.roleChoices);
check("nothing written yet", (await db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get()).empty);

/** An answer the couple's page would send for this question. */
function answerFor(field: Field): unknown {
  switch (field.type) {
    case "checkbox":
    case "acknowledgement":
      return true;
    case "multi_select":
      return field.options.slice(0, 1);
    case "dropdown":
    case "radio":
      return field.options[0] ?? "Yes";
    case "date":
      return eventDate;
    case "time":
      return "15:30";
    case "email":
      return coupleEmail;
    case "phone":
      return "+1 617 555 0199";
    default:
      return `Walk answer for ${field.label}`;
  }
}
const writable = fields.filter((field) => !field.locked && field.type !== "information");
// What came filled in is left as it is, as the couple would.
const required = writable.filter((field) => field.required && startedWith[field.id] === undefined);
const half = required.slice(0, Math.max(1, Math.floor(required.length / 2)));
const rest = required.slice(half.length);

step("6. Booking before the form is sent: refused");
const slots = await couple("inquiry_availability", { token });
check("times 200", slots.status === 200, slots);
const offered = (slots.body.slots ?? []) as Array<{ startsAt: string }>;
check("times offered", offered.length >= 2, offered.length);
const blocked = await couple("inquiry_book", { token, startsAt: offered[0]?.startsAt, format: "zoom" });
check("inquiry_book refused with INQUIRY_FORM_REQUIRED", blocked.status === 400 && blocked.body.error === "INQUIRY_FORM_REQUIRED", blocked);
check("no consultation made", (await db.collection("consultations").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get()).empty);

step("7. inquiry_form_save — part of it, not sent");
const partial = await couple("inquiry_form_save", {
  token,
  submit: false,
  answers: Object.fromEntries(half.map((field) => [field.id, answerFor(field)])),
});
check("partial save 200", partial.status === 200, partial);
check("partial save is in progress", partial.body.status === "in_progress", partial.body);
const responseId = String(partial.body.responseId ?? "");
let response = await db.doc(`questionnaireResponses/${responseId}`).get();
check("questionnaireResponses doc exists", response.exists);
check("…on the job", response.get("projectId") === projectId, response.get("projectId"));
check("…for the studio", response.get("tenantId") === tenantId);
check("…marked source inquiry_page", response.get("source") === "inquiry_page", response.get("source"));
check("…tied to the lead", response.get("leadId") === leadId);
check("…in_progress", response.get("status") === "in_progress", response.get("status"));
check("…no submittedAt", !response.get("submittedAt"));

step("8. inquiry_form — the reload shows what was saved");
const reloaded = await couple("inquiry_form", { token });
const savedAnswers = (reloaded.body.answers ?? {}) as Record<string, unknown>;
check("reload status in_progress", reloaded.body.status === "in_progress", reloaded.body.status);
check(
  "every saved answer comes back",
  half.every((field) => JSON.stringify(savedAnswers[field.id]) === JSON.stringify(answerFor(field))),
  { saved: savedAnswers, expected: Object.fromEntries(half.map((field) => [field.id, answerFor(field)])) },
);
preview = await couple("inquiry_preview", { token });
check("preview shows the form in progress", (preview.body.eventForm as { status?: string })?.status === "in_progress");

step("9. Sending it with questions left: refused");
const incomplete = await couple("inquiry_form_save", { token, submit: true, answers: {} });
check("submit refused with INQUIRY_FORM_INCOMPLETE", incomplete.status === 400 && incomplete.body.error === "INQUIRY_FORM_INCOMPLETE", incomplete);

step("10. inquiry_form_save — the rest, and send");
const sent = await couple("inquiry_form_save", {
  token,
  submit: true,
  answers: Object.fromEntries(rest.map((field) => [field.id, answerFor(field)])),
});
check("submit 200", sent.status === 200, sent);
check("submit reports submitted", sent.body.status === "submitted", sent.body);
response = await db.doc(`questionnaireResponses/${responseId}`).get();
check("response is submitted", response.get("status") === "submitted", response.get("status"));
check("response has submittedAt", Boolean(response.get("submittedAt")));
check("response complete", response.get("completionPercent") === 100, response.get("completionPercent"));
check(
  "the prefilled answers were sent as given",
  Object.entries(startedWith).every(([fieldId, value]) => JSON.stringify((response.get("answers") ?? {})[fieldId]) === JSON.stringify(value)),
  { started: startedWith, stored: response.get("answers") },
);
check("still the one response on the job", (await db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get()).size === 1);
const analysisPath = `aiJobs/questionnaire_${responseId}`;
check("AI read NOT queued at submit (no call booked yet)", !(await db.doc(analysisPath).get()).exists);
const again = await couple("inquiry_form_save", { token, submit: false, answers: { [half[0]!.id]: "changed after sending" } });
check("a save after sending is refused (QUESTIONNAIRE_ALREADY_SUBMITTED)", again.status === 400 && again.body.error === "QUESTIONNAIRE_ALREADY_SUBMITTED", again);

step("11. inquiry_availability → inquiry_book — the call");
const bookedAt = now();
const booked = await couple("inquiry_book", { token, startsAt: offered[0]!.startsAt, format: "zoom" });
check("book 201", booked.status === 201, booked);
check("book scheduled", booked.body.status === "scheduled", booked.body);
const consultationId = String(booked.body.consultationId ?? "");
const consultation = await db.doc(`consultations/${consultationId}`).get();
check("consultation exists", consultation.exists);
check("consultation scheduled", consultation.get("status") === "scheduled", consultation.get("status"));
check("consultation on the job", consultation.get("projectId") === projectId);
check("consultation at the picked time", consultation.get("startsAt") === offered[0]!.startsAt);
check("job moved to CONSULTATION", (await db.doc(`projects/${projectId}`).get()).get("state") === "CONSULTATION");
const analysis = await db.doc(analysisPath).get();
check("AI read queued at booking", analysis.exists);
check("…as questionnaire_analysis", analysis.get("type") === "questionnaire_analysis", analysis.get("type"));
check("…for this response and job", analysis.get("responseId") === responseId && analysis.get("projectId") === projectId);
check("…created at the booking, not the submit", String(analysis.get("createdAt")) >= bookedAt, { createdAt: analysis.get("createdAt"), bookedAt });
check("…human review required", analysis.get("humanReviewRequired") === true);
const firstQueuedAt = analysis.get("createdAt");
preview = await couple("inquiry_preview", { token });
check("preview shows the call booked", Boolean(preview.body.booked), preview.body.booked);
check("preview shows the form sent", (preview.body.eventForm as { status?: string })?.status === "submitted");

step("12. Moving the call — the read is not queued again");
// A phone call needs a number (548b996); a forwarded inquiry has none.
const moved = await couple("inquiry_book", { token, startsAt: offered[1]!.startsAt, format: "phone", phone: "617 555 0100" });
check("move 201", moved.status === 201, moved);
check("move reported as rescheduled", moved.body.rescheduled === true, moved.body);
check("old consultation rescheduled", (await db.doc(`consultations/${consultationId}`).get()).get("status") === "rescheduled");
const analysisAfterMove = await db.doc(analysisPath).get();
check("analysis job still the one from the booking", analysisAfterMove.get("createdAt") === firstQueuedAt, {
  before: firstQueuedAt,
  after: analysisAfterMove.get("createdAt"),
});
const analysisJobs = await db.collection("aiJobs").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get();
check(
  "exactly one questionnaire_analysis job on the job",
  analysisJobs.docs.filter((document: { get: (field: string) => unknown }) => document.get("type") === "questionnaire_analysis").length === 1,
);

/* ── B: the call booked first, the form sent after ─────────────────────── */

step("B1. A second dateless couple; the studio books their call before the form");
const tagB = randomUUID().slice(0, 8);
const capturedB = await captureInquiry({
  db,
  tenantId,
  route: "forward",
  providerMessageId: `walk-b-${tagB}`,
  now: now(),
  email: {
    from: "studio@alderandmuse.example",
    fromName: "Alder & Muse",
    replyTo: null,
    subject: "Fwd: Wedding photographer",
    text: [
      "---------- Forwarded message ---------",
      `From: Maya Ortiz <walk-b-${tagB}@example.com>`,
      "Date: Thu, Oct 1, 2026 at 10:02 AM",
      "Subject: Wedding photographer",
      "To: <studio@alderandmuse.example>",
      "",
      "Hello! Sam and I are getting married and looking for a wedding photographer. No date yet. Could we chat?",
      "",
      "Maya",
    ].join("\n"),
    html: null,
    studioAddresses: ["studio@alderandmuse.example"],
  },
});
check("B: capture made a new dateless inquiry", capturedB.outcome === "lead_created" && capturedB.projectId === null, capturedB);
const replyB = await withInquiryLink(db, { tenantId, leadId: capturedB.leadId, body: "Hi Maya,\n\nThanks!\n\nBest,\nAlder & Muse", now: now() });
const tokenB = /\/i\/([A-Za-z0-9_-]+)/.exec(replyB.body)?.[1] ?? "";
const dateB = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10);
const detailsB = await couple("inquiry_details", { token: tokenB, details: { eventDate: dateB } });
check("B: the date makes the job", detailsB.body.hasJob === true, detailsB);
const projectB = String((await db.doc(`leads/${capturedB.leadId}`).get()).get("projectId") ?? "");
const jobB = await db.doc(`projects/${projectB}`).get();
const slotB = ((await couple("inquiry_availability", { token: tokenB })).body.slots as Array<{ startsAt: string; endsAt: string }>)[3]!;
const scheduled = await studio("bookingCommand", "scheduleConsultation", {
  projectId: projectB,
  contactId: (jobB.get("clientContactIds") as string[])[0],
  mode: "zoom",
  startsAt: slotB.startsAt,
  endsAt: slotB.endsAt,
  timezone: "America/New_York",
  location: null,
});
check("B: studio's scheduleConsultation accepted", scheduled.status === 200, scheduled);
const analysisJobsB = async () =>
  (await db.collection("aiJobs").where("tenantId", "==", tenantId).where("projectId", "==", projectB).get()).docs.filter(
    (document: { get: (field: string) => unknown }) => document.get("type") === "questionnaire_analysis",
  );
check("B: nothing to analyse yet — no AI job at the booking", (await analysisJobsB()).length === 0);
const previewB = await couple("inquiry_preview", { token: tokenB });
check("B: the page shows the call booked", Boolean(previewB.body.booked), previewB.body.booked);
check("B: and still offers the form", (previewB.body.eventForm as { status?: string } | null)?.status === "not_started", previewB.body.eventForm);

step("B2. The couple sends the form after the call is booked: queued at submit");
const formB = await couple("inquiry_form", { token: tokenB });
const fieldsB = ((formB.body.sections ?? []) as Array<{ fields: Field[] }>).flatMap((section) => section.fields);
const startB = (formB.body.answers ?? {}) as Record<string, unknown>;
const sentB = await couple("inquiry_form_save", {
  token: tokenB,
  submit: true,
  answers: Object.fromEntries(
    fieldsB
      .filter((field) => field.required && !field.locked && field.type !== "information" && startB[field.id] === undefined)
      .map((field) => [field.id, answerFor(field)]),
  ),
});
check("B: submit 200", sentB.status === 200 && sentB.body.status === "submitted", sentB);
const queuedB = await analysisJobsB();
check("B: AI read queued at submit", queuedB.length === 1, queuedB.length);
check("B: for the response sent", queuedB[0]?.get("responseId") === sentB.body.responseId);

console.log(`\nTALLY pass=${passes} fail=${failures}  tenant=${tenantId} lead=${leadId} project=${projectId} response=${responseId}`);
console.log(`analysis job status now: ${String(analysisAfterMove.get("status"))}`);
process.exit(failures ? 1 : 0);
