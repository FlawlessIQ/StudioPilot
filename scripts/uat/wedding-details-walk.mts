/**
 * Wedding details walk: the planning form sent on the studio's timeline, the
 * final details opened on the lock day, a couple's change after the lock
 * asked and accepted, the sign-off confirmed, and a change after it recorded
 * beside what was signed — StudioCue's own code, in-process against the
 * Firestore emulator. Nothing between the steps is written by hand.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/uat/wedding-details-walk.mts
 */
import { createRequire } from "node:module";

const REPO = process.cwd();
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing to run without FIRESTORE_EMULATOR_HOST (the emulator).");
const projectId = process.env.GCLOUD_PROJECT ?? "studiohub-dev";
if (/prod/i.test(projectId)) throw new Error(`Refusing to run against project "${projectId}".`);

const functionsRequire = createRequire(`${REPO}/functions/package.json`);
functionsRequire("firebase-admin/app").initializeApp({ projectId });
const db = functionsRequire("firebase-admin/firestore").getFirestore();
const { planningFormScheduler } = await import(`${REPO}/functions/src/planning/planning-form-scheduler.ts`);
const { finalDetailsScheduler } = await import(`${REPO}/functions/src/planning/final-details.ts`);
const { requestDetailChange, decideDetailChange } = await import(`${REPO}/functions/src/planning/detail-changes.ts`);
const { confirmFinalDetails } = await import(`${REPO}/server/planning/final-details.ts`);

const results: boolean[] = [];
const record = (step: string, ok: boolean, detail: string) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${step} — ${detail}`);
};

const run = Date.now().toString(36);
const T = `details-walk-${run}`;
const now = new Date();
const iso = now.toISOString();
const inDays = (days: number) => new Date(now.valueOf() + days * 86_400_000).toISOString().slice(0, 10);
const field = (id: string, label: string, type = "text") => ({ id, label, type, required: false, locked: false, internalOnly: false, options: [], conditionalOn: null });
const eventForm = [{ id: "event", title: "Your day", fields: [field("prep", "Bride Getting Ready Address"), field("ceremony", "Ceremony Location"), field("reception", "Reception Location"), field("ctime", "Ceremony Times"), field("guests", "# of Invited Guests")] }];
const planning = [{ id: "day", title: "The day", fields: [field("photos", "Photo locations on the way to the hotel"), field("start", "Ceremony start time", "time"), field("planner", "Planner or coordinator")] }];

await db.doc(`tenants/${T}`).set({ id: T, tenantId: T, brandName: "Walk Studio", timezone: "America/New_York", status: "active", planningTimeline: { formMonthsBefore: 6, formSend: "auto", formTemplateId: null, lockDaysBefore: 28 } });
await db.doc(`questionnaireTemplates/${T}-event`).set({ id: `${T}-event`, tenantId: T, name: "Wedding Event Info", eventTypeId: "wedding", status: "active", version: 1, sections: eventForm, createdAt: "2026-09-01T00:00:00Z" });
await db.doc(`questionnaireTemplates/${T}-plan`).set({ id: `${T}-plan`, tenantId: T, name: "Wedding Planning Questionnaire", eventTypeId: "wedding", status: "active", version: 1, sections: planning, dueDaysBeforeEvent: 45, reminderDaysBeforeDue: [14], createdAt: "2026-09-02T00:00:00Z" });
await db.doc(`leadCaptureSettings/${T}`).set({ tenantId: T, inquiryEventForm: { templateId: `${T}-event` } });
const job = async (id: string, name: string, eventDate: string, extra: Record<string, unknown> = {}) => {
  await db.doc(`projects/${id}`).set({ id, tenantId: T, projectId: id, name, eventType: "Wedding", eventTypeId: "wedding", state: "BOOKED", eventDate, timezone: "America/New_York", clientContactIds: [`${id}-c`], archivedAt: null, ...extra });
  await db.doc(`contacts/${id}-c`).set({ id: `${id}-c`, tenantId: T, firstName: name.split(" ")[0], email: `${id}@studiohub.test`, archivedAt: null });
  await db.doc(`questionnaireResponses/${id}-event`).set({
    id: `${id}-event`, tenantId: T, projectId: id, templateId: `${T}-event`, templateName: "Wedding Event Info", source: "inquiry_page", status: "submitted", submittedAt: iso,
    templateSnapshot: { sections: eventForm }, answers: { prep: "The Lodge, 14 Mill Lane", ceremony: "St Mary's Church", reception: "Harbor View Estate", ctime: "3:00 PM", guests: "140" },
    answerProvenance: {}, changeHistory: [],
  });
};
const A = `${T}-a`, B = `${T}-b`, C = `${T}-c`;
await job(A, "Avery & Sam", inDays(150));
await job(B, "Blake & Lane", inDays(20));
await job(C, "Quinn & Rivers", inDays(150), { clientAutomationsPausedAt: iso });
await db.doc(`schedules/${B}-v1`).set({
  id: `${B}-v1`, tenantId: T, projectId: B, version: 1, status: "published", approvalState: "client_approved", timezone: "America/New_York",
  items: [
    { id: "i1", title: "Ceremony", startAt: `${inDays(20)}T19:00:00Z`, visibility: "shared", location: "St Mary's Church" },
    { id: "i2", title: "Photos at the park", startAt: `${inDays(20)}T20:30:00Z`, visibility: "client", location: "Boathouse Park" },
    { id: "i3", title: "Crew arrive", startAt: `${inDays(20)}T17:00:00Z`, visibility: "crew" },
  ],
});

// --- 1. the planning form, on the studio's timeline -----------------------------------
await planningFormScheduler.run({} as never);
const formsFor = async (id: string) => (await db.collection("questionnaireResponses").where("tenantId", "==", T).where("projectId", "==", id).get()).docs.filter((doc: { get(field: string): unknown }) => doc.get("templateId") === `${T}-plan`);
const aForms = await formsFor(A);
const aEmails = (await db.collection("emailJobs").where("tenantId", "==", T).where("projectId", "==", A).get()).docs.map((doc: { get(field: string): unknown }) => doc.get("type"));
record("1 five months out, on automatic: the planning form goes", aForms.length === 1 && aEmails.includes("questionnaire_request"), `${aForms.length} form, emails: ${aEmails.join(", ")}`);
record("1 not the inquiry form, and never a quiet job", (await formsFor(C)).length === 0, `quiet job: ${(await formsFor(C)).length} forms`);
await planningFormScheduler.run({} as never);
record("1 the next day: no second copy", (await formsFor(A)).length === 1, `${(await formsFor(A)).length} form`);

// --- 2. the lock day: final details opened ------------------------------------------
await finalDetailsScheduler.run({} as never);
const signoff = async (id: string) => (await db.doc(`detailSignoffs/${T}_${id}`).get()).data() ?? null;
const b = await signoff(B);
const bEmail = (await db.doc(`emailJobs/final_details_request_${T}_${B}`).get()).data();
record("2 twenty days out: the couple is asked to confirm", b?.status === "awaiting_couple" && Boolean(bEmail) && bEmail?.clientOutreachGuard === true, `${b?.status}; email ${bEmail?.type}`);
const rows = (b?.snapshot?.rows ?? []) as Array<{ label: string; value: string }>;
const timeline = (b?.snapshot?.timeline ?? []) as Array<{ time: string; title: string; location: string | null }>;
record(
  "2 everything on it: locations, times, their timeline (not the crew's)",
  rows.some((row) => row.label === "Ceremony" && row.value === "St Mary's Church") && rows.some((row) => row.label === "Reception") && timeline.length === 2 && timeline[1]?.title === "Photos at the park",
  `${rows.map((row) => `${row.label}: ${row.value}`).join(" · ")} | ${timeline.map((row) => `${row.time} ${row.title}`).join(", ")}`,
);
record("2 not yet for a wedding five months out", (await signoff(A)) === null, "none");

// --- 3. after the lock: a change is a request, then agreed -----------------------------
const asked = await requestDetailChange(db, { tenantId: T, projectId: B, responseId: `${B}-event`, fieldId: "ctime", value: "3:30 PM", note: "The priest asked", actorId: "couple-b", now: new Date().toISOString() });
let refusedLittle = "";
try {
  await requestDetailChange(db, { tenantId: T, projectId: B, responseId: `${B}-event`, fieldId: "guests", value: "150", note: null, actorId: "couple-b", now: new Date().toISOString() });
} catch (caught) {
  refusedLittle = (caught as Error).message;
}
record("3 a time after the lock: a request; the guest count: theirs to change", asked.status === "pending" && refusedLittle === "FIELD_NOT_LOCKABLE", `request ${asked.status}; guests → ${refusedLittle}`);
await decideDetailChange(db, { tenantId: T, projectId: B, requestId: asked.requestId, decision: "accept", actorId: "studio-owner", now: new Date().toISOString() });
const bForm = (await db.doc(`questionnaireResponses/${B}-event`).get()).data() ?? {};
const task = (await db.doc(`tasks/detail_change_timeline_${asked.requestId}`).get()).data();
const agreedEmail = (await db.doc(`emailJobs/detail_change_accept_${asked.requestId}`).get()).data();
record(
  "3 accepted: the answer changes, the couple is told, the published timeline gets a task",
  bForm.answers?.ctime === "3:30 PM" && bForm.answerProvenance?.ctime?.label === "Changed at the couple's request" && Boolean(task) && /agreed/.test(String(agreedEmail?.customSubject)),
  `${bForm.answers?.ctime}; task "${task?.title}"; email "${agreedEmail?.customSubject}"`,
);
const refreshed = await signoff(B);
record("3 still awaiting: what they'll confirm now says 3:30", (refreshed?.snapshot?.rows ?? []).some((row: { value: string }) => row.value === "3:30 PM"), "snapshot refreshed");

// --- 4. the couple confirms; a later change is recorded beside it ----------------------
let stale = "";
try {
  await confirmFinalDetails(db as never, { tenantId: T, projectId: B, typedName: "Blake Lane", snapshotHash: String(b?.snapshotHash), signer: { uid: "couple-b", email: `${B}@studiohub.test`, emailVerified: true, authMethod: "password" }, evidence: { ipAddress: null, userAgent: "walk" } });
} catch (caught) {
  stale = (caught as Error).message;
}
await confirmFinalDetails(db as never, { tenantId: T, projectId: B, typedName: "Blake Lane", snapshotHash: String(refreshed?.snapshotHash), signer: { uid: "couple-b", email: `${B}@studiohub.test`, emailVerified: true, authMethod: "password" }, evidence: { ipAddress: null, userAgent: "walk" } });
const confirmed = await signoff(B);
record("4 the old page is refused; what they read is what they sign", stale === "FINAL_DETAILS_CHANGED" && confirmed?.status === "confirmed" && confirmed?.confirmedBy?.typedName === "Blake Lane", `${stale} → ${confirmed?.status} by ${confirmed?.confirmedBy?.typedName}`);
const later = await requestDetailChange(db, { tenantId: T, projectId: B, responseId: `${B}-event`, fieldId: "reception", value: "The Boathouse", note: null, actorId: "couple-b", now: new Date().toISOString() });
await decideDetailChange(db, { tenantId: T, projectId: B, requestId: later.requestId, decision: "accept", actorId: "studio-owner", now: new Date().toISOString() });
const after = await signoff(B);
record(
  "4 a change after confirming: recorded beside the signed details, which stay as signed",
  after?.snapshotHash === confirmed?.snapshotHash && (after?.changes ?? []).some((change: { label: string; to: string }) => change.label === "Reception Location" && change.to === "The Boathouse"),
  `${(after?.changes ?? []).map((change: { label: string; from: string; to: string }) => `${change.label}: ${change.from} → ${change.to}`).join("; ")}`,
);
const declined = await requestDetailChange(db, { tenantId: T, projectId: B, responseId: `${B}-event`, fieldId: "prep", value: "Hotel Mira", note: null, actorId: "couple-b", now: new Date().toISOString() });
await decideDetailChange(db, { tenantId: T, projectId: B, requestId: declined.requestId, decision: "decline", actorId: "studio-owner", now: new Date().toISOString() });
const kept = (await db.doc(`questionnaireResponses/${B}-event`).get()).data() ?? {};
record("4 declined: it stays, and they're told", kept.answers?.prep === "The Lodge, 14 Mill Lane" && Boolean((await db.doc(`emailJobs/detail_change_decline_${declined.requestId}`).get()).exists), `prep still "${kept.answers?.prep}"`);

const failed = results.filter((ok) => !ok).length;
console.log(`TALLY ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
