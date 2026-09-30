/**
 * After the UAT fixture (scripts/uat/fixture.mts) adds its jobs to the demo
 * studio — a proposal awaiting signature, a crew offer, delivered jobs with
 * couple accounts — this undoes the one thing it sets only to test: a pale
 * pink brand colour chosen to exercise the contrast clamp. Videos show the
 * studio's default look. Emulator only.
 */
import { createRequire } from "node:module";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing to run without the Firestore emulator.");
const require = createRequire(`${process.cwd()}/package.json`);
const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const tenantId = process.argv[2];
if (!tenantId) throw new Error("usage: fixture-tidy.mts <tenantId>");
initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "studiohub-dev" });
const db = getFirestore();
await db.doc(`tenants/${tenantId}`).update({ "emailBranding.primaryColor": FieldValue.delete() });

// Hana Park's reply, as the inquiry-reply job would have drafted it. That job
// runs on the operations scheduler, which the emulator never fires, so the
// inquiry video would otherwise show a card with nothing to review.
const now = new Date().toISOString();
const lead = (await db.doc("leads/lead-park").get()).data() ?? {};
await db.doc("aiActions/ai_reply_lead-park").set({
  id: "ai_reply_lead-park",
  tenantId,
  projectId: lead.projectId ?? null,
  actorId: "vertex-ai-worker",
  title: "Reply to Hana Park",
  capability: "inquiry_reply_draft",
  authorityBoundary: "draft_requires_review",
  status: "review_required",
  modelProvider: "google_vertex_ai",
  modelVersion: "deterministic-mock",
  instructionVersion: "inquiry-reply-v1",
  outputSchemaVersion: "inquiry-reply-v1",
  sourceReferences: [{ entityType: "lead", entityId: "lead-park", versionId: null, label: "Original inquiry", locator: "lead.message" }],
  structuredOutput: {
    subject: "Your wedding at The Rockleigh",
    body:
      "Hi Hana,\n\nThank you so much for reaching out, and please thank Priya for us! The Rockleigh is a beautiful place to be married, and yes, we offer both photo and film.\n\n" +
      "Tell us a little more about your day and pick a time to talk — it takes two minutes: https://studio-cue.com/i/alder-muse-hana\n\nWarmly,\nAlder & Muse",
    recipientEmail: lead.email ?? "hana.park@example.com",
    recipientName: lead.displayName ?? "Hana Park",
    leadId: "lead-park",
    contactId: lead.primaryContactId ?? null,
    suggestedConsultationQuestions: [],
    bookingLinkIncluded: true,
  },
  confidence: { overall: 0.93, label: "high", uncertainFields: [] },
  validation: { status: "passed", issues: [] },
  decision: null,
  downstreamCommand: { commandType: "create_communication_draft", commandId: "reply_lead-park", executedAt: null },
  usage: { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, latencyMs: 0, estimatedMinutesSaved: 8 },
  failure: null,
  snoozedUntil: null,
  createdAt: now,
  updatedAt: now,
  createdBy: "vertex-ai-worker",
  updatedBy: "vertex-ai-worker",
  archivedAt: null,
});
// Ada & Tobi Okafor with nobody asked yet, so the crew video can staff a job
// from the start. The demo gives every booked job an offer out already.
const okaforOffers = await db.collection("crewAssignments").where("tenantId", "==", tenantId).where("projectId", "==", "job-okafor").get();
for (const doc of okaforOffers.docs) await doc.ref.delete();
const okaforCascades = await db.collection("crewCascades").where("tenantId", "==", tenantId).where("projectId", "==", "job-okafor").get();
for (const doc of okaforCascades.docs) await doc.ref.delete();

// Camila & Andrés with their edit done, so the delivery video has a gallery
// to release. The demo leaves their post-production checklist unstarted.
const ownerId = (await getAuth().getUserByEmail("owner@studiohub.test")).uid;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const done = (n: number) => ({ complete: true, completedAt: daysAgo(n), completedBy: ownerId, evidenceId: null, notes: null });
const open = { complete: false, completedAt: null, completedBy: null, evidenceId: null, notes: null };
await db.doc("postProductionRecords/job-rivera").set({
  id: "job-rivera", tenantId, projectId: "job-rivera",
  steps: {
    backup_complete: done(24), cull_complete: done(20), editing_started: done(18), editing_complete: done(3), gallery_ready: done(1),
    album_proof_ready: open, delivery_sent: open, client_downloaded: open, project_archived: open,
  },
  currentStep: "delivery_sent", targetDeliveryDate: new Date(Date.now() + 16 * 86_400_000).toISOString().slice(0, 10), archivedAt: null,
  createdAt: daysAgo(24), updatedAt: daysAgo(1), createdBy: ownerId, updatedBy: ownerId,
});

// Harper & Lane with their proposal accepted and the agreement out, as it is
// once a couple accepts. The UAT fixture leaves the job at PROPOSAL, where
// signing is refused (features/contracts/signing-policy.ts).
await db.doc("projects/uat-job-a").update({ state: "CONTRACT_PENDING", stateVersion: FieldValue.increment(1) });
await db.doc("proposals/prop-uat-a-v1").update({ status: "accepted", acceptedAt: daysAgo(1) });

console.log(`Tidied ${tenantId}: default brand colour, Hana Park's reply drafted.`);
