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
console.log(`Tidied ${tenantId}: default brand colour, Hana Park's reply drafted.`);
