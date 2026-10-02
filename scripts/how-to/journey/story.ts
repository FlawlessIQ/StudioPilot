/* eslint-disable @typescript-eslint/no-explicit-any -- a film's story reading
   loosely-shaped emulator documents and functions modules, never shipped. */
/**
 * The story behind the journey film: one couple, Ella & Marcus Hart, from
 * their first inquiry to the album, in the demo studio (Alder & Muse).
 *
 * The film is recorded chapter by chapter, each starting from the snapshot
 * the one before it left (make.ts). On camera, people click — Ella on her
 * phone, the studio at its desk, Jordan on theirs. Between those moments the
 * story moves the world on, and the time it takes is cut from the video:
 *
 *   - Time passes by moving the wedding, not the clock. A beat like
 *     `weeks-to-go:8` sets the Harts' date eight weeks out, then runs the
 *     scheduled jobs that would fire on that day. The dates on screen aren't
 *     a consistent calendar; the order of things, and what each person sees,
 *     is real (Conor, 2026-10-02: accuracy of dates doesn't matter).
 *   - The emulator never runs scheduled functions or the task queue, so the
 *     story runs them itself, then drains the email/AI/PDF queues — the same
 *     way scripts/uat/*-walk.mts do. Every email it sends is captured as
 *     rendered (emails.ts), so the film shows the real one.
 *
 * Emulator only: refuses to run without the how-to stack's emulator hosts.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HOW_TO_HOME } from "../lib/voice";
import { EMAIL_DIR, clearEmails } from "./emails";

export const HARTS = {
  ella: { email: "ella.hart@studiohub.test", first: "Ella", last: "Hart", phone: "617 555 0188" },
  marcus: { first: "Marcus", last: "Hart" },
  name: "Ella & Marcus",
  venue: "Willow Creek Barn",
  city: "Concord",
  guests: "140",
};
const STUDIO_SLUG = "alder-and-muse";

const STACK = {
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:18080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:19099",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:19199",
  GCLOUD_PROJECT: "studiohub-dev",
  GOOGLE_CLOUD_PROJECT: "studiohub-dev",
  EMAIL_DELIVERY_MODE: "mock",
  HOW_TO_EMAIL_DIR: EMAIL_DIR,
};

type Db = {
  doc(path: string): { get(): Promise<Snap>; set(data: object, options?: object): Promise<unknown>; update(data: object): Promise<unknown> };
  collection(path: string): Query;
};
type Query = { where(field: string, op: string, value: unknown): Query; get(): Promise<{ docs: Snap[]; size: number }> };
type Snap = { id: string; exists: boolean; ref: { update(data: object): Promise<unknown>; set(data: object, o?: object): Promise<unknown> }; data(): Record<string, any> | undefined; get(field: string): any };

let booted: Promise<{ db: Db; auth: any; fns: (rel: string) => Promise<any>; tenantId: string }> | null = null;

/** Points this process at the how-to stack's emulators, and loads what functions code needs. */
function boot() {
  booted ??= (async () => {
    const repo = process.cwd();
    // The stack's functions env (the app URL in links, mock providers), then the repo's.
    for (const file of [path.join(HOW_TO_HOME, "app", "functions", ".env.local"), path.join(repo, ".env.local")]) {
      try {
        for (const line of readFileSync(file, "utf8").split("\n")) {
          const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
          if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
        }
      } catch {}
    }
    Object.assign(process.env, STACK);
    // Links in the emails the film shows read as the real product's. Nobody
    // follows them: scripts open Ella's pages by path (resolvePath).
    process.env.NEXT_PUBLIC_APP_URL = "https://studio-cue.com";
    const functionsRequire = createRequire(`${repo}/functions/package.json`);
    const { initializeApp, getApps } = functionsRequire("firebase-admin/app");
    if (!getApps().length) initializeApp({ projectId: STACK.GCLOUD_PROJECT });
    const db = functionsRequire("firebase-admin/firestore").getFirestore() as Db;
    const auth = functionsRequire("firebase-admin/auth").getAuth();
    const fns = (rel: string) => import(path.join(repo, "functions", "src", rel));
    const tenants = await db.collection("tenants").where("slug", "==", STUDIO_SLUG).get();
    if (!tenants.size) throw new Error(`No "${STUDIO_SLUG}" tenant: is the how-to stack seeded?`);
    return { db, auth, fns, tenantId: tenants.docs[0]!.id };
  })();
  return booted;
}

const iso = () => new Date().toISOString();
const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Sends whatever is queued — email, AI drafts, PDFs — as the scheduler would every minute. */
async function drain() {
  const { db, fns, tenantId } = await boot();
  // A send from Today is held for the undo window (communications/undo-send.ts);
  // wait it out, so what the studio just sent goes now.
  const queued = await db.collection("emailJobs").where("tenantId", "==", tenantId).where("status", "==", "queued").get();
  const soonest = Math.max(
    0,
    ...queued.docs.map((doc) => Date.parse(String(doc.get("sendAfter") ?? doc.get("nextAttemptAt") ?? "")) || 0).filter((t) => t - Date.now() < 30_000),
  );
  if (soonest > Date.now()) await new Promise((resolve) => setTimeout(resolve, soonest - Date.now() + 500));
  const { operationsJobScheduler } = await fns("operations/jobs.ts");
  for (let pass = 0; pass < 3; pass++) await operationsJobScheduler.run({} as never);
}

/** The Harts' job, once their inquiry has made one. */
async function hartsJob() {
  const { db, tenantId } = await boot();
  const contacts = await db.collection("contacts").where("tenantId", "==", tenantId).where("normalizedEmail", "==", HARTS.ella.email).get();
  const contact = contacts.docs[0];
  if (!contact) throw new Error("The Harts haven't been in touch yet (no contact for Ella).");
  const projectIds: string[] = contact.get("projectIds") ?? [];
  const projectId = projectIds.at(-1);
  if (!projectId) throw new Error("Ella's contact has no job yet.");
  return { contact, projectId, project: (await db.doc(`projects/${projectId}`).get()).data() ?? {} };
}

async function hartsLead() {
  const { db, tenantId } = await boot();
  const leads = await db.collection("leads").where("tenantId", "==", tenantId).where("email", "==", HARTS.ella.email).get();
  const lead = leads.docs[0];
  if (!lead) throw new Error("No lead for Ella yet.");
  return lead;
}

/**
 * The studio's agreement, written in StudioCue, and "sign and send it for me
 * when a proposal is accepted" switched on — through the real commands, as
 * the owner, so the agreement goes out the moment Ella accepts.
 */
async function agreementReady() {
  const { db, auth, fns, tenantId } = await boot();
  const tenant = (await db.doc(`tenants/${tenantId}`).get()).data() ?? {};
  if (tenant.defaultContractSettings?.agreementTemplateId && tenant.defaultContractSettings?.nativeAutoSend?.enabled) return;
  const owner = await auth.getUserByEmail("owner@studiohub.test");
  const membership = (await db.doc(`memberships/${tenantId}_${owner.uid}`).get()).data() ?? {};
  const context = (key: string) => ({
    tenantId, membership, actorId: owner.uid, actorEmail: owner.email ?? null, authMethod: "password", emailVerified: true,
    timestamp: iso(), idempotencyKey: `how-to-${key}`, ipAddress: null, userAgent: "how-to story",
  });
  await db.doc(`tenants/${tenantId}`).set({ legalName: "Alder & Muse Photography LLC" }, { merge: true });
  const { STARTER_AGREEMENT } = await import(path.join(process.cwd(), "features", "contracts", "sample.ts"));
  const body = String(STARTER_AGREEMENT)
    .replace("[Replace with your own cancellation and rescheduling terms.]", "If the Client cancels, the retainer is kept. A new date within twelve months can be arranged once, subject to availability.")
    .replace("[Replace with your own terms on copyright, usage and portfolio rights.]", "The Studio keeps copyright. The Client may print and share the images for personal use, and the Studio may show them in its portfolio.")
    .replace("[Replace with your own terms.]", "Meals are provided for the photographers during coverage.");
  const { saveAgreementTemplate, setContractAutoSend } = await fns("contracts/commands.ts");
  await saveAgreementTemplate(context("agreement"), { templateId: null, name: "Wedding agreement", title: "Wedding photography agreement", body, customFields: [], makeDefault: true });
  await setContractAutoSend(context("auto-send"), { enabled: true, signerName: "Conor Lawless", consent: true });
}

/**
 * The closing number, counted from the run, never estimated: every email
 * that went to Ella or Jordan about this wedding. StudioCue wrote all of
 * them — from a template, or as a draft the studio approved — and the studio
 * typed none (in the film it types only the gallery link).
 */
async function tallyRun() {
  const { db, tenantId } = await boot();
  const { projectId } = await hartsJob();
  const emails = await db.collection("emailJobs").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get();
  const toThem = emails.docs.filter((doc) => !String(doc.get("type")).startsWith("studio_") && doc.get("to") !== "owner@studiohub.test");
  return { auto: toThem.length };
}

/** Ella's own inquiry page, /i/<token> — minted the way the first reply mints it. */
async function inquiryLink() {
  const { db, fns, tenantId } = await boot();
  const lead = await hartsLead();
  const { inquiryLinkFor } = await fns("intake/inquiry-link.ts");
  return (await inquiryLinkFor(db, { tenantId, leadId: lead.id, now: iso() })) as string;
}

/**
 * Fills a path the script can't know when it's written: `{inquiry}` is Ella's
 * inquiry page, `{job}` the Harts' job id.
 */
export async function resolvePath(template: string): Promise<string> {
  let out = template;
  if (out.includes("{tally.")) {
    const tally = await tallyRun();
    out = out.replace("{tally.auto}", String(tally.auto));
  }
  if (out.includes("{inquiry}")) out = out.replace("{inquiry}", new URL(await inquiryLink()).pathname);
  if (out.includes("{job}")) out = out.replace("{job}", (await hartsJob()).projectId);
  return out;
}

const beats: Record<string, (arg?: string) => Promise<void>> = {
  /** Before chapter 1: Ella has an account to come back to later, and no email has been sent yet. */
  async cast() {
    const { auth, db, tenantId } = await boot();
    clearEmails();
    // The studio's own default look. The UAT fixture sets a pale pink to test
    // the contrast clamp; fixture-tidy.mts removes it, but not always first.
    const { FieldValue } = createRequire(`${process.cwd()}/functions/package.json`)("firebase-admin/firestore");
    await db.doc(`tenants/${tenantId}`).update({ "emailBranding.primaryColor": FieldValue.delete() });
    // Call times for Ella to pick from. The demo studio has none set, so its
    // inquiry page says "we'll be in touch" instead of offering any.
    await db.doc(`consultationSettings/${tenantId}`).set({
      id: tenantId, tenantId,
      durationMinutes: 45, bufferMinutes: 15, mode: "closed_default",
      windows: ["mon", "tue", "wed", "thu", "fri", "sat"].map((day) => ({ day, startMinute: 10 * 60, endMinute: 18 * 60 })),
      unavailableWindows: [], blockedDates: [], meetingFormats: ["zoom", "phone"], inPersonLocation: null,
      createdAt: iso(), updatedAt: iso(), createdBy: "how-to", updatedBy: "how-to",
    });
    try {
      await auth.getUserByEmail(HARTS.ella.email);
    } catch {
      await auth.createUser({
        email: HARTS.ella.email,
        password: process.env.SEED_DEMO_PASSWORD,
        displayName: `${HARTS.ella.first} ${HARTS.ella.last}`,
        emailVerified: true,
      });
    }
  },

  /** `drain:undo` first waits out a send the studio could still undo. */
  async drain(arg) {
    if (arg === "undo") await new Promise((resolve) => setTimeout(resolve, 12_000));
    await drain();
  },

  /**
   * StudioCue's reply to Ella, ready to approve. The inquiry-reply job runs on
   * the operations scheduler with a model behind it; in the emulator the
   * model is a placeholder, so the draft is written as the job would write it
   * (the same as scripts/how-to/fixture-tidy.mts does for Hana Park).
   */
  async "reply-drafted"() {
    const { db, tenantId } = await boot();
    await drain();
    const lead = await hartsLead();
    const data = lead.data() ?? {};
    const id = `ai_reply_${lead.id}`;
    const link = await inquiryLink();
    await db.doc(`aiActions/${id}`).set({
      id, tenantId, projectId: data.projectId ?? null, actorId: "vertex-ai-worker",
      title: `Reply to ${HARTS.ella.first} ${HARTS.ella.last}`,
      capability: "inquiry_reply_draft", authorityBoundary: "draft_requires_review", status: "review_required",
      modelProvider: "google_vertex_ai", modelVersion: "deterministic-mock", instructionVersion: "inquiry-reply-v1", outputSchemaVersion: "inquiry-reply-v1",
      sourceReferences: [{ entityType: "lead", entityId: lead.id, versionId: null, label: "Original inquiry", locator: "lead.message" }],
      structuredOutput: {
        subject: `Your wedding at ${HARTS.venue}`,
        body:
          `Hi ${HARTS.ella.first},\n\nThank you so much for getting in touch — congratulations to you and ${HARTS.marcus.first}! ${HARTS.venue} is a beautiful place to be married, and your date is open.\n\n` +
          `Tell us a little more about your day and pick a time to talk — it takes two minutes: ${link}\n\nWarmly,\nAlder & Muse`,
        recipientEmail: HARTS.ella.email, recipientName: `${HARTS.ella.first} ${HARTS.ella.last}`,
        leadId: lead.id, contactId: data.primaryContactId ?? null, suggestedConsultationQuestions: [], bookingLinkIncluded: true,
      },
      confidence: { overall: 0.94, label: "high", uncertainFields: [] },
      validation: { status: "passed", issues: [] },
      decision: null,
      downstreamCommand: { commandType: "create_communication_draft", commandId: `reply_${lead.id}`, executedAt: null },
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, latencyMs: 0, estimatedMinutesSaved: 8 },
      failure: null, snoozedUntil: null, createdAt: iso(), updatedAt: iso(), createdBy: "vertex-ai-worker", updatedBy: "vertex-ai-worker", archivedAt: null,
    });
  },
};

Object.assign(beats, {
  /**
   * Ella has a portal login. In the product she gets one from the invitation
   * that comes with her proposal; the film signs her in before that email is
   * shown, so the membership is made here, the way accepting it would.
   */
  async "ella-joins"() {
    const { db, auth, tenantId } = await boot();
    // Couples sign in StudioCue itself — a per-studio switch the platform
    // turns on (docs/contracts.md); the demo studio doesn't have it.
    await db.doc(`tenantFeatures/${tenantId}`).set({ tenantId, nativeContractSigning: true }, { merge: true });
    await agreementReady();
    const { contact, projectId } = await hartsJob();
    const ella = await auth.getUserByEmail(HARTS.ella.email);
    const owner = await auth.getUserByEmail("owner@studiohub.test");
    const stamp = { createdAt: iso(), updatedAt: iso(), createdBy: owner.uid, updatedBy: owner.uid };
    await db.doc(`users/${ella.uid}`).set({ id: ella.uid, email: HARTS.ella.email, displayName: `${HARTS.ella.first} ${HARTS.ella.last}`, emailVerified: true, photoUrl: null, phone: null, lastLoginAt: null, archivedAt: null, ...stamp }, { merge: true });
    await db.doc(`memberships/${tenantId}_${ella.uid}`).set({ id: `${tenantId}_${ella.uid}`, tenantId, userId: ella.uid, role: "client", explicitPermissions: [], projectIds: [projectId], status: "active", ...stamp });
    await contact.ref.update({ portalUserId: ella.uid });
  },

  /**
   * The call is tomorrow: Ella's consultation moves to 20 hours from now and
   * the hourly "Ahead of our call" job runs, preparing the note for approval.
   */
  async "call-tomorrow"() {
    const { db, fns, tenantId } = await boot();
    const { projectId } = await hartsJob();
    const calls = await db.collection("consultations").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get();
    const call = calls.docs[0];
    if (!call) throw new Error("Ella hasn't booked a call.");
    const startsAt = new Date(Date.now() + 20 * 3_600_000);
    startsAt.setUTCMinutes(0, 0, 0);
    const minutes = (Date.parse(String(call.get("endsAt"))) - Date.parse(String(call.get("startsAt")))) / 60_000 || 45;
    await call.ref.update({ startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.valueOf() + minutes * 60_000).toISOString() });
    const { consultationPrepScheduler } = await fns("booking/consultation-prep.ts");
    await consultationPrepScheduler.run({} as never);
    await drain();
  },
} satisfies Record<string, (arg?: string) => Promise<void>>);

async function hartsInvoice(kind = "retainer") {
  const { db, tenantId } = await boot();
  const { projectId } = await hartsJob();
  const invoices = await db.collection("invoiceReferences").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get();
  const invoice = invoices.docs.find((doc) => doc.get("kind") === kind);
  if (!invoice) throw new Error(`No ${kind} invoice for the Harts yet (kinds: ${invoices.docs.map((d) => d.get("kind")).join(", ")}).`);
  return { invoice, projectId };
}

Object.assign(beats, {
  /**
   * The retainer as a studio with online payments sees it: a pay link on the
   * invoice. The demo's QuickBooks is a mock without QuickBooks Payments, so
   * the link is set here — what QuickBooks would hand back.
   */
  async "retainer-link"(kind) {
    const { invoice } = await hartsInvoice(kind || "retainer");
    await invoice.ref.update({ hostedUrl: `https://connect.intuit.com/portal/app/CommerceNetwork/view/${invoice.id}` });
  },
  /**
   * Ella pays. In the product QuickBooks reports it; the emulator has no
   * QuickBooks, so the payment lands through the same record the studio's own
   * "Record a payment" writes.
   */
  async "retainer-paid"(kind) {
    const { db, auth, fns, tenantId } = await boot();
    const { invoice, projectId } = await hartsInvoice(kind || "retainer");
    const owner = await auth.getUserByEmail("owner@studiohub.test");
    const { recordInvoicePayment } = await fns("booking/invoice-payments.ts");
    await recordInvoicePayment(
      db,
      { tenantId, role: "studio_owner", actorId: owner.uid, now: iso(), idempotencyKey: `how-to-retainer-${invoice.id}`, ipAddress: null, userAgent: "how-to story" },
      { projectId, invoiceId: invoice.id, amountCents: Number(invoice.get("balanceCents")), paidAt: iso().slice(0, 10), method: "Card, online", reference: null, attestation: true },
    );
    await drain();
  },
} satisfies Record<string, (arg?: string) => Promise<void>>);

/** Where a wedding's date lives besides the job, so moving it moves everything that hangs off it. */
const DATED = ["crewAssignments", "crewCalendarEvents", "crewCascades", "crewStaffingPlans", "schedules", "scheduleVersions", "crewScheduleViews", "events"];

/**
 * Time passing, the film's way: the Harts' wedding moves to `days` from now.
 * Every date on their records within three days of the old wedding moves by
 * the same amount (call times, the crew's calendar, the run of show), so the
 * day still hangs together; then the day's scheduled jobs run.
 */
async function moveWedding(days: number) {
  const { db, tenantId } = await boot();
  const { projectId, project } = await hartsJob();
  const old = Date.parse(`${project.eventDate}T12:00:00Z`);
  const target = Date.parse(`${dayOffset(days)}T12:00:00Z`);
  const delta = target - old;
  if (!delta) return;
  const near = (ms: number) => Math.abs(ms - old) <= 3 * 86_400_000;
  const shift = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value) && near(Date.parse(`${value}T12:00:00Z`)))
        return new Date(Date.parse(`${value}T12:00:00Z`) + delta).toISOString().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) && near(Date.parse(value))) return new Date(Date.parse(value) + delta).toISOString();
      return value;
    }
    if (Array.isArray(value)) return value.map(shift);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v)]));
    return value;
  };
  const moved = (data: Record<string, unknown>) => {
    const next = shift(data) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(next).filter(([k]) => JSON.stringify(next[k]) !== JSON.stringify(data[k])));
  };
  const projectChanges = moved(project);
  if (Object.keys(projectChanges).length) await db.doc(`projects/${projectId}`).update(projectChanges);
  for (const name of DATED) {
    const docs = await db.collection(name).where("tenantId", "==", tenantId).where("projectId", "==", projectId).get();
    for (const doc of docs.docs) {
      const changes = moved(doc.data() ?? {});
      if (Object.keys(changes).length) await doc.ref.update(changes);
    }
  }
}

Object.assign(beats, {
  /** Ella finishes her planning questionnaire, over a few evenings, and sends it. */
  async "questionnaire-done"() {
    const { db, tenantId } = await boot();
    const { projectId } = await hartsJob();
    const responses = await db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get();
    const response = responses.docs.find((doc) => doc.get("source") !== "inquiry_page" && doc.get("status") !== "completed");
    if (!response) throw new Error("No open questionnaire for the Harts.");
    const answers = { ...(response.get("answers") ?? {}), ...ELLA_ANSWERS };
    await command(HARTS.ella.email, "planningCommand", "saveQuestionnaire", { responseId: response.id, projectId, answers, submit: true });
    await drain();
  },
  /** Editing has begun: the job moves to post-production, as the studio's stage control does. */
  async "editing-started"() {
    const { projectId, project } = await hartsJob();
    await command("owner@studiohub.test", "crmCommand", "transitionProject", {
      projectId, expectedVersion: Number(project.stateVersion ?? 0), targetState: "POST_PRODUCTION", reason: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
  },
  /** The edit is done: cards backed up, culled, edited, the gallery ready to send. */
  async "gallery-ready"() {
    const { db, auth } = await boot();
    const { projectId } = await hartsJob();
    const owner = await auth.getUserByEmail("owner@studiohub.test");
    const done = (days: number) => ({ complete: true, completedAt: new Date(Date.now() - days * 86_400_000).toISOString(), completedBy: owner.uid, evidenceId: null, notes: null });
    await db.doc(`postProductionRecords/${projectId}`).set(
      { steps: { backup_complete: done(30), cull_complete: done(24), editing_started: done(22), editing_complete: done(3), gallery_ready: done(1) }, currentStep: "delivery_sent", updatedAt: iso() },
      { merge: true },
    );
  },
  /**
   * `review-due:1` — the first review ask (in the portal, three days after
   * delivery) comes due, and the scheduler sends it; `:2` is the email at ten.
   */
  async "review-due"(arg) {
    const { db, fns, tenantId } = await boot();
    const { projectId } = await hartsJob();
    const sequence = Number(arg || 1);
    const asks = await db.collection("reviewRequests").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get();
    const ask = asks.docs.find((doc) => Number(doc.get("sequence")) === sequence);
    if (!ask) throw new Error(`No review ask ${sequence} for the Harts (is a review link set?).`);
    await ask.ref.update({ scheduledAt: new Date(Date.now() - 60_000).toISOString() });
    const { reviewRequestScheduler } = await fns("post-event/jobs.ts");
    await reviewRequestScheduler.run({} as never);
    await drain();
  },
  /** Jordan's W-9 arrives, as the crew paperwork request would bring it. */
  async "crew-paperwork"() {
    const { db, tenantId } = await boot();
    const { projectId } = await hartsJob();
    await db.doc("crewProfiles/crew-jordan").set({ w9Status: "received", insuranceStatus: "received" }, { merge: true });
    const assignments = await db.collection("crewAssignments").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get();
    for (const doc of assignments.docs) {
      const requirements = (doc.get("requirements") ?? []) as Array<Record<string, unknown>>;
      await doc.ref.update({ requirements: requirements.map((item) => (item.kind === "w9" ? { ...item, status: "complete", completedAt: iso() } : item)) });
    }
  },
  /** `wedding-in:180` — the Harts' wedding is 180 days away. */
  async "wedding-in"(arg) {
    await moveWedding(Number(arg));
  },
  /** `scheduler:planning/planning-form-scheduler.ts:planningFormScheduler` — runs one scheduled job, then sends what it queued. */
  async scheduler(arg) {
    const { fns } = await boot();
    const [file, name] = String(arg).split("#");
    const scheduled = await fns(file!);
    await scheduled[name!].run({} as never);
    await drain();
  },
} satisfies Record<string, (arg?: string) => Promise<void>>);

/**
 * A command through the real HTTP function in the stack's functions emulator,
 * signed in as `email` — the same request the app makes when they tap.
 */
async function command(email: string, fn: string, type: string, input: Record<string, unknown>) {
  const { tenantId } = await boot();
  const signIn = await fetch(`http://${STACK.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: process.env.SEED_DEMO_PASSWORD, returnSecureToken: true }),
  });
  const { idToken } = (await signIn.json()) as { idToken?: string };
  if (!idToken) throw new Error(`${email} couldn't sign in to the emulator.`);
  const response = await fetch(`http://127.0.0.1:15001/${STACK.GCLOUD_PROJECT}/us-east4/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ type, tenantId, idempotencyKey: `how-to-${type}-${Date.now()}`, input }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${fn} ${type} → ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text || "{}");
}

/** What Ella would write in her planning questionnaire, by question. */
const ELLA_ANSWERS: Record<string, unknown> = {
  "day-of-contact": "Sophie Hart (sister), 617 555 0144",
  "ceremony-address": "Willow Creek Barn, 400 Old Mill Rd, Concord, MA 01742",
  "reception-address": "Same as the ceremony: the barn and the meadow tent",
  "getting-ready": "Ella at the farmhouse on site; Marcus at the Colonial Inn, Concord",
  "first-look": "Yes",
  planner: "June & Co. Events (Priya)",
  florist: "Wild Bloom Studio",
  "must-have-groups": "Both families together\nElla's parents and sister\nMarcus's parents and grandparents (flying in from Dublin)\nWedding party",
  "sensitivities": "Marcus's grandparents tire easily: their photos early, please.",
  "first-look-time": "14:45",
  "cocktail-hour-time": "17:15",
  "dinner-time": "18:30",
  "cake-cutting-time": "20:15",
  "sunset-priority": "Essential",
  "end-time": "22:00",
  "social-consent": true,
};

/** A wall-clock time on the Harts' wedding day, in the studio's zone, as an ISO instant. */
function onTheDay(date: string, time: string, zone = "America/New_York") {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((out, part) => ({ ...out, [part.type]: part.value }), {});
  const asZone = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:00Z`);
  return new Date(guess - (asZone - guess)).toISOString();
}

/**
 * The run of show the model drafts from Ella's answers. The emulator has no
 * Vertex, so the film answers the studio's "Generate draft" with this — the
 * same shape aiScheduleCommand returns — and the studio reviews and publishes
 * it through the real screens and commands.
 */
async function scheduleDraft() {
  const { project } = await hartsJob();
  const date = String(project.eventDate);
  const q = (sourceId: string, label: string) => ({ type: "questionnaire_answer" as const, sourceId, label });
  const item = (id: string, from: string, to: string, title: string, location: string, description: string, refs: ReturnType<typeof q>[] = [], notes: string | null = null) => ({
    id, startAt: onTheDay(date, from), endAt: onTheDay(date, to), title, description, location, address: null, travelMinutes: 0,
    crewIds: [], participants: [], vendorContactIds: [], equipment: [], notes, visibility: "shared" as const, blockingIssues: [], sourceReferences: refs,
  });
  return {
    items: [
      item("getting-ready", "14:30", "15:15", "Getting ready", "The farmhouse", "Details, dress and the last few minutes before.", [q("getting-ready", "Where are you getting ready?")]),
      item("first-look", "15:15", "15:45", "First look", "The meadow path", "Just the two of you, before the ceremony.", [q("first-look", "Are you planning a first look?")]),
      item("wedding-party", "15:45", "16:15", "Wedding party portraits", "The meadow", "Full party, then smaller groups."),
      item("ceremony", "16:30", "17:00", "Ceremony", "Willow Creek Barn", "Processional to recessional.", [q("ceremony-time", "Ceremony start time")]),
      item("family", "17:00", "17:40", "Family photographs", "Barn steps", "Both families together, then each side.", [q("must-have-groups", "Groups we must photograph")], "Marcus's grandparents first: they tire easily."),
      item("cocktails", "17:40", "18:30", "Cocktail hour", "The meadow tent", "Candids of guests.", [q("cocktail-hour-time", "Cocktail hour start time")]),
      item("dinner", "18:30", "19:10", "Dinner", "The barn", "Room details before guests sit."),
      item("sunset", "19:10", "19:30", "Sunset portraits", "The west field", "Golden hour, as they asked.", [q("sunset-priority", "How important are sunset portraits?")]),
      item("toasts", "19:30", "20:15", "Toasts and first dance", "The barn", "Toasts, then the first dance."),
      item("cake", "20:15", "20:30", "Cake cutting", "The barn", "", [q("cake-cutting-time", "Cake cutting time")]),
      item("dancing", "20:30", "22:00", "Dancing and send-off", "The barn", "Dance floor, then the sparkler exit.", [q("end-time", "When does coverage end?")]),
    ],
    assumptions: ["The farmhouse and the barn are a two-minute walk apart."],
    missingInformation: ["When the reception doors open to guests."],
    conflicts: [],
    risks: ["Sunset is close to toasts: twenty minutes for portraits."],
    suggestedQuestions: ["Who will gather each family group?"],
    interactionId: `how-to-${Date.now()}`,
    humanReviewRequired: true,
    sourceTrace: { questionnaireCount: 9, timingRuleCount: 0, crewFactCount: 1, assumptionItemCount: 0 },
  };
}

/** Named stand-ins for calls the emulator can't make (the `respond` action). */
export async function respond(name: string): Promise<unknown> {
  if (name === "schedule-draft") return scheduleDraft();
  throw new Error(`No response named "${name}".`);
}

export async function story(beat: string): Promise<void> {
  const at = beat.indexOf(":");
  const [name, arg] = at < 0 ? [beat, undefined] : [beat.slice(0, at), beat.slice(at + 1)];
  const run = beats[name!];
  if (!run) throw new Error(`Unknown story beat "${beat}". Known: ${Object.keys(beats).join(", ")}`);
  await run(arg);
}

export { boot, drain, hartsJob, hartsLead, dayOffset };
