/**
 * "Ahead of our call" walk: the scheduler, the draft for approval, the
 * automatic facts-only note through the real email worker, and the quiet
 * booking left alone — StudioCue's own code against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/uat/consultation-prep-walk.mts
 */
import { createRequire } from "node:module";

const REPO = process.cwd();
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing to run without FIRESTORE_EMULATOR_HOST (the emulator).");
const projectId = process.env.GCLOUD_PROJECT ?? "studiohub-dev";
if (/prod/i.test(projectId)) throw new Error(`Refusing to run against project "${projectId}".`);
process.env.EMAIL_DELIVERY_MODE = "mock";

const functionsRequire = createRequire(`${REPO}/functions/package.json`);
functionsRequire("firebase-admin/app").initializeApp({ projectId });
const db = functionsRequire("firebase-admin/firestore").getFirestore();
const { consultationPrepScheduler } = await import(`${REPO}/functions/src/booking/consultation-prep.ts`);
const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);

const results: boolean[] = [];
const record = (step: string, ok: boolean, detail: string) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${step} — ${detail}`);
};

const run = Date.now().toString(36);
const now = new Date();
const inHours = (hours: number) => new Date(now.valueOf() + hours * 3_600_000).toISOString();
const field = (id: string, label: string, type: string) => ({ id, label, type, required: false, locked: false, internalOnly: false, options: [], conditionalOn: null });

async function studio(tenantId: string, autoSend: boolean) {
  await db.doc(`tenants/${tenantId}`).set({
    id: tenantId, tenantId, brandName: "Walk Studio", timezone: "America/New_York", status: "active",
    ...(autoSend ? { lifecycleMessaging: { consultation_prep: { enabled: true, offsetDays: -1, autoSend: true } } } : {}),
  });
}
async function job(tenantId: string, id: string, name: string, extra: Record<string, unknown> = {}) {
  await db.doc(`projects/${id}`).set({ id, tenantId, projectId: id, name, state: "CONSULTATION", timezone: "America/New_York", clientContactIds: [`${id}-c`], archivedAt: null, ...extra });
  await db.doc(`contacts/${id}-c`).set({ id: `${id}-c`, tenantId, firstName: name.split(" ")[0], lastName: "Walk", email: `${id}@studiohub.test`, archivedAt: null });
  await db.doc(`questionnaireResponses/${id}-form`).set({
    id: `${id}-form`, tenantId, projectId: id, source: "inquiry_page", status: "submitted", templateName: "Event form",
    templateSnapshot: { sections: [{ id: "day", title: "Your day", fields: [field("date", "Wedding date", "date"), field("venue", "Venue", "text"), field("time", "Ceremony start time", "time"), field("guests", "Expected guest count", "text")] }] },
    answers: { date: "2027-06-12", venue: "The Barn at Hudson", time: "16:30", guests: "140" },
    aiReview: { suggestedQuestions: ["Who will help gather family for the group photos?", "Is there a rain plan for the ceremony?"], planningRisks: ["Sunset is tight against dinner"] },
  });
}
async function call(tenantId: string, id: string, projectIdOf: string, startsAt: string) {
  await db.doc(`consultations/${id}`).set({
    id, tenantId, projectId: projectIdOf, contactId: `${projectIdOf}-c`, status: "scheduled", mode: "zoom", joinUrl: "https://zoom.us/j/123",
    startsAt, endsAt: startsAt, timezone: "America/New_York", selfServeUrl: "https://studio-cue.com/i/walk", archivedAt: null,
  });
}

const T1 = `prep-walk-${run}`, T2 = `prep-walk-auto-${run}`;
await studio(T1, false);
await studio(T2, true);
await job(T1, `${T1}-a`, "Avery & Sam");
await job(T1, `${T1}-q`, "Quinn & Rivers", { clientAutomationsPausedAt: now.toISOString() });
await job(T2, `${T2}-b`, "Blake & Lane");
await call(T1, `${T1}-call-a`, `${T1}-a`, inHours(20));
await call(T1, `${T1}-call-later`, `${T1}-a`, inHours(72));
await call(T1, `${T1}-call-q`, `${T1}-q`, inHours(20));
await call(T2, `${T2}-call-b`, `${T2}-b`, inHours(20));

await consultationPrepScheduler.run({} as never);
const action = async (id: string) => (await db.doc(`aiActions/ai_consultation_prep_${id}`).get()).data() ?? null;

const a = await action(`${T1}-call-a`);
record("1 the day before: a draft waits for the studio", a?.status === "review_required" && a.capability === "consultation_prep_draft", `${a?.status}, "${a?.structuredOutput?.subject}" to ${a?.structuredOutput?.recipientEmail}`);
const body = String(a?.structuredOutput?.body ?? "");
record("1 their answers, read back", /• Venue: The Barn at Hudson/.test(body) && /• Ceremony start time: 4:30 PM/.test(body) && /• Wedding date: June 12, 2027/.test(body), "answers present");
record("1 with the AI's questions for them — never its notes for the studio", /A few things we'd like to talk about:\n• Who will help gather family/.test(body) && !/Sunset is tight/.test(body), "talk-about present, risks absent");
record("1 the call: when, how, and where to change it", /Looking forward to our call on \w+day, \w+ \d+ at \d+:\d{2} [AP]M \(E[DS]T\)/.test(body) && /On Zoom: https:\/\/zoom\.us\/j\/123/.test(body) && /studio-cue\.com\/i\/walk/.test(body), body.split("\n")[0]);
console.log("\n--- the draft ---\n" + body + "\n---\n");
record("2 not yet for a call three days out", (await action(`${T1}-call-later`)) === null, "no draft");
record("2 never for a quiet (imported) booking", (await action(`${T1}-call-q`)) === null, "no draft");

const b = await action(`${T2}-call-b`);
const email = (await db.doc(`emailJobs/consultation_prep_email_${T2}-call-b`).get()).data();
record("3 automatic: sent at once, the facts alone", b?.status === "executed" && Boolean(email) && !/talk about/.test(String(email?.customBody)), `${b?.status}; email ${email ? "queued" : "missing"}; button ${email?.actionLabel}`);
await processJobDocument("emailJobs", `consultation_prep_email_${T2}-call-b`);
const sent = (await db.collection("messages").where("tenantId", "==", T2).get()).docs.map((doc: { data(): Record<string, unknown> }) => doc.data());
record("3 through the real sender", sent.length === 1 && /Ahead of our call/.test(String(sent[0]?.subject)), `"${sent[0]?.subject}" → ${sent[0]?.to ?? sent[0]?.recipient}`);

await consultationPrepScheduler.run({} as never);
const emails = await db.collection("emailJobs").where("tenantId", "==", T2).get();
record("4 the next hour: nobody asked twice", emails.size === 1, `${emails.size} email`);

const failed = results.filter((ok) => !ok).length;
console.log(`TALLY ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
