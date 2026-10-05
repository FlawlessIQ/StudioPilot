/**
 * UAT scenario on top of the emulator seed: Jobs A, B, C (and E for a decline),
 * three couple accounts, and the seed's crew member. Emulator only.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const REPO = process.cwd();
const require = createRequire(`${REPO}/package.json`);
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Refusing to run without emulator hosts.");
}
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { canonicalJson } = await import(`${REPO}/features/contracts/document.ts`);

initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "studiohub-dev" });
const auth = getAuth();
const db = getFirestore();
const tenantId = process.argv[2];
const password = process.env.SEED_DEMO_PASSWORD!;
if (!tenantId || !password) throw new Error("usage: fixture.mts <tenantId>, with SEED_DEMO_PASSWORD");

const TZ = "America/New_York";
const now = new Date();
const nowIso = now.toISOString();
function nyOffset(instant: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(new Date(instant)).find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
function at(days: number, hour: number, minute = 0): string {
  const base = new Date(now);
  base.setUTCDate(base.getUTCDate() + days);
  const wall = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute);
  return new Date(wall - nyOffset(wall) * 60_000).toISOString();
}
const dateOnly = (days: number) => at(days, 12).slice(0, 10);
const audit = (uid: string) => ({ createdAt: nowIso, updatedAt: nowIso, createdBy: uid, updatedBy: uid });

async function ensureUser(email: string, name: string) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    return auth.createUser({ email, password, displayName: name, emailVerified: true });
  }
}

const owner = await auth.getUserByEmail("owner@studiohub.test");
const crew = await auth.getUserByEmail("crew@studiohub.test");
const couples = {
  a: await ensureUser("uat-a@studiohub.test", "Harper Lane"),
  b: await ensureUser("uat-b@studiohub.test", "Rowan Blake"),
  c: await ensureUser("uat-c@studiohub.test", "Quinn Rivers"),
};
const A = audit(owner.uid);
const batch = db.batch();

// Brand: a pale colour to check the contrast clamp, and the event-day phone.
batch.set(db.doc(`tenants/${tenantId}`), {
  brandName: "Alder & Muse",
  emailBranding: { primaryColor: "#F2B8C6" },
  eventDayPhone: "+1 617 555 0142",
}, { merge: true });

const projects = [
  { key: "a", id: "uat-job-a", name: "Harper & Lane", state: "PROPOSAL", date: dateOnly(25), venue: "Harbor View Estate", city: "Gloucester" },
  { key: "b", id: "uat-job-b", name: "Rowan & Blake", state: "DELIVERED", date: dateOnly(-8), venue: "Lakeside Lodge", city: "Concord" },
  { key: "c", id: "uat-job-c", name: "Quinn & Rivers", state: "DELIVERED", date: dateOnly(-15), venue: "The Mill", city: "Lowell" },
  { key: null, id: "uat-job-e", name: "Sage & Ellis", state: "BOOKED", date: dateOnly(40), venue: "Crane Estate", city: "Ipswich" },
] as const;
for (const p of projects) {
  batch.set(db.doc(`projects/${p.id}`), {
    ...A, id: p.id, tenantId, projectId: p.id, name: p.name, eventType: "Wedding", eventTypeId: "wedding",
    eventDate: p.date, timezone: TZ, state: p.state, stateVersion: 0,
    clientContactIds: [`contact-${p.id}`], leadPhotographerId: owner.uid, leadPhotographerName: "Conor Lawless",
    packageSnapshotId: null, venueName: p.venue, city: p.city, readinessScore: 50,
    nextAction: "UAT", leadId: null, archivedAt: null,
  });
  const couple = p.key ? couples[p.key] : null;
  batch.set(db.doc(`contacts/contact-${p.id}`), {
    ...A, id: `contact-${p.id}`, tenantId, firstName: p.name.split(" ")[0], lastName: p.name.split(" ").at(-1),
    displayName: p.name, email: couple?.email ?? `${p.id}@studiohub.test`, normalizedEmail: couple?.email ?? `${p.id}@studiohub.test`,
    phone: null, normalizedPhone: null, company: null, contactTypes: ["client"], projectIds: [p.id],
    portalUserId: couple?.uid ?? null, marketingConsent: false, notes: null, archivedAt: null,
  });
  if (couple) {
    batch.set(db.doc(`users/${couple.uid}`), {
      ...A, id: couple.uid, email: couple.email, displayName: couple.displayName, emailVerified: true,
      photoUrl: null, phone: null, lastLoginAt: null, archivedAt: null,
    }, { merge: true });
    batch.set(db.doc(`memberships/${tenantId}_${couple.uid}`), {
      ...A, id: `${tenantId}_${couple.uid}`, tenantId, userId: couple.uid, role: "client",
      explicitPermissions: [], projectIds: [p.id], status: "active",
    });
  }
}
// The crew member can open Job B (accepted, past); Job A opens on acceptance.
batch.set(db.doc(`memberships/${tenantId}_${crew.uid}`), {
  projectIds: ["wedding-booked", "wedding-ready", "uat-job-b"],
}, { merge: true });
batch.set(db.doc("crewProfiles/crew-jordan"), { w9Status: "missing", insuranceStatus: "received" }, { merge: true });

// ---- Job A: booking and planning --------------------------------------
const base = 650000, addOn = 85000;
batch.set(db.doc("packageSnapshots/snap-uat-a"), {
  id: "snap-uat-a", tenantId, projectId: "uat-job-a", packageId: "signature-wedding", packageVersion: 1,
  packageName: "The Signature Collection", description: "Eight hours, two photographers and a highlight film.",
  currency: "USD", basePriceCents: base,
  addOns: [{ addOnId: "engagement-session", name: "Engagement session", quantity: 1, unitPriceCents: addOn, lineTotalCents: addOn, taxable: false }],
  discountCents: 0, subtotalCents: base + addOn, taxCents: 0, retainerCents: 220500, totalCents: base + addOn,
  includedCoverageMinutes: 480, includedCoverage: [{ role: "photographer", count: 2 }, { role: "videographer", count: 1 }],
  includedPhotographers: 2, includedDeliverables: ["Online gallery", "Highlight film"],
  terms: "Governed by the signed agreement.", selectionDate: nowIso, selectedBy: owner.uid, immutable: true,
  createdAt: nowIso, createdBy: owner.uid,
});
batch.set(db.doc("proposals/prop-uat-a-v1"), {
  ...A, id: "prop-uat-a-v1", tenantId, projectId: "uat-job-a", packageSnapshotId: "snap-uat-a", version: 1, status: "sent",
  clientSnapshot: { displayName: "Harper & Lane", email: couples.a.email },
  eventSnapshot: { name: "Harper & Lane", eventType: "Wedding", eventDate: dateOnly(25), timezone: TZ, venue: "Harbor View Estate" },
  pricingSnapshot: {
    currency: "USD", packageName: "The Signature Collection", subtotalCents: base + addOn, discountCents: 0, taxCents: 0,
    retainerCents: 220500, totalCents: base + addOn,
    lineItems: [
      { description: "The Signature Collection", quantity: 1, unitPriceCents: base, totalCents: base },
      { description: "Engagement session", quantity: 1, unitPriceCents: addOn, totalCents: addOn },
    ],
  },
  paymentSchedule: [
    { label: "Retainer", amountCents: 220500, dueDate: dateOnly(3) },
    { label: "Final balance", amountCents: base + addOn - 220500, dueDate: dateOnly(11) },
  ],
  expiresAt: at(14, 23, 59), notes: null, termsSummary: "The signed agreement governs the photography.",
  pdfDocumentId: null, sentAt: nowIso, viewedAt: null, acceptedAt: null, supersedesId: null, archivedAt: null,
});
const contractDocument = {
  format: 1,
  title: "Photography agreement",
  blocks: [
    { type: "heading", level: 1, content: [{ text: "Photography agreement" }] },
    { type: "paragraph", content: [{ text: "Between Alder & Muse Photography and Harper & Lane, for the wedding at Harbor View Estate." }] },
    { type: "heading", level: 2, content: [{ text: "Coverage" }] },
    { type: "list", items: [{ content: [{ text: "Eight hours, two photographers and a videographer." }] }, { content: [{ text: "An online gallery and a highlight film." }] }] },
    { type: "payment_schedule", rows: [{ label: "Retainer", amount: "$2,205.00", due: "On signing" }, { label: "Final balance", amount: "$5,145.00", due: "Two weeks before" }] },
  ],
};
batch.set(db.doc("contracts/contract-uat-a"), {
  ...A, id: "contract-uat-a", tenantId, projectId: "uat-job-a", proposalId: "prop-uat-a-v1", status: "sent",
  provider: "studiocue", providerEnvelopeId: null, providerState: "not_applicable", templateId: "uat", templateVersionId: "uat-v1",
  document: contractDocument, documentHash: createHash("sha256").update(canonicalJson(contractDocument), "utf8").digest("hex"),
  unresolvedFields: [], mergeOverrides: {},
  signers: [
    { name: "Conor Lawless", email: "owner@studiohub.test", role: "studio", order: 1, status: "completed", signedAt: nowIso },
    { name: "Harper Lane", email: couples.a.email, role: "primary_client", order: 2, status: "sent", signedAt: null },
  ],
  signatures: [{ id: "sig-studio-uat-a", role: "studio", typedName: "Conor Lawless", signedAt: nowIso }],
  sentAt: nowIso, viewedAt: null, completedAt: null, signedDocumentId: null, certificateDocumentId: null,
  completionEvidence: null, fileHash: null, lastProviderEventId: null, voidedAt: null, voidedBy: null, voidReason: null,
  remindersSent: 0, lastReminderAt: null, archivedAt: null,
});
batch.set(db.doc("invoiceReferences/inv-uat-a-retainer"), {
  ...A, id: "inv-uat-a-retainer", tenantId, projectId: "uat-job-a", kind: "retainer", provider: "stripe",
  providerInvoiceId: "in_uat_a", providerCustomerId: "cus_uat_a", status: "sent", currency: "USD",
  amountCents: 220500, balanceCents: 220500, dueDate: dateOnly(3), hostedUrl: "https://example.com/pay/uat-a",
  lastSyncedAt: nowIso, lastProviderEventId: null, archivedAt: null,
});
const field = (id: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({
  id, label, type, required: false, locked: false, internalOnly: false, options: [], conditionalOn: null, ...extra,
});
batch.set(db.doc("questionnaireResponses/qr-uat-a"), {
  ...A, id: "qr-uat-a", tenantId, projectId: "uat-job-a", templateId: "uat-wedding", templateVersion: 1,
  name: "Wedding day planning", templateName: "Wedding day planning", status: "in_progress", dueDate: dateOnly(10),
  templateSnapshot: {
    sections: [
      { id: "day", title: "The day", fields: [
        field("ceremony-time", "Ceremony start time", "time", { required: true }),
        field("first-look", "Are you planning a first look?", "radio", { options: ["Yes", "No", "Not sure yet"] }),
        field("colours", "Your colors", "multi_select", { options: ["Sage", "Ivory", "Gold", "Blush"] }),
      ] },
      { id: "family", title: "Family photos", fields: [
        field("must-have-groups", "Family formals", "long_text", { required: true }),
        field("family-helper", "Is someone helping gather family?", "radio", { options: ["Yes", "No"] }),
        field("family-helper-name", "Their name and phone", "text", { conditionalOn: { fieldId: "family-helper", equals: "Yes" } }),
      ] },
      { id: "care", title: "Handle with care", fields: [
        field("no-photo-list", "Anyone we shouldn't photograph?", "long_text"),
        field("studio-notes", "Studio notes", "long_text", { internalOnly: true }),
        field("venue-rules", "We'll share any venue photography rules", "acknowledgement", { required: true }),
      ] },
    ],
  },
  answers: { "studio-notes": "Bring the 85mm for the vows." },
  answerProvenance: {}, changeHistory: [], completionPercent: 0, submittedAt: null, archivedAt: null,
});
const item = (id: string, title: string, start: string, end: string, visibility: string, location: string, description = "") => ({
  id, startAt: start, endAt: end, title, description, location, address: null, travelMinutes: 0,
  photographerIds: [owner.uid], participants: [], vendorContactIds: [], equipment: [], notes: null, visibility, blockingIssues: [],
});
const jobAItems = [
  item("arrive", "Crew arrive, meet the lead", at(25, 13), at(25, 13, 30), "crew", "Staff entrance"),
  item("prep", "Getting ready", at(25, 13, 30), at(25, 15), "shared", "Carriage house"),
  item("ceremony", "Ceremony", at(25, 17), at(25, 17, 30), "shared", "Garden lawn", "Wide from the back row. No flash."),
  item("formals", "Family formals", at(25, 17, 35), at(25, 18, 5), "shared", "Terrace steps"),
  item("reception", "Reception", at(25, 19), at(25, 23), "shared", "Glass hall"),
];
batch.set(db.doc("schedules/sched-uat-a-v1"), {
  ...A, id: "sched-uat-a-v1", tenantId, projectId: "uat-job-a", version: 1, status: "client_review", timezone: TZ,
  items: jobAItems, approvalState: "client_pending", publishedAt: nowIso, approvedBy: null, pdfDocumentId: null,
  dropboxDocumentId: null, supersedesId: null, immutable: true, archivedAt: null,
});
batch.set(db.doc("messages/msg-uat-a-1"), {
  ...A, id: "msg-uat-a-1", tenantId, projectId: "uat-job-a", direction: "outbound", channel: "portal", visibility: "shared",
  subject: "Welcome to your planning space", body: "So happy to be photographing your day! Everything lives here now.",
  bodyPreview: "So happy to be photographing your day!", context: null, status: "delivered",
  createdAt: at(-2, 10), sentAt: at(-2, 10), clientReadAt: null, archivedAt: null,
});
batch.set(db.doc("documents/doc-uat-a-photo"), {
  ...A, id: "doc-uat-a-photo", tenantId, projectId: "uat-job-a", name: "Venue walkthrough.png", fileName: "venue.png",
  category: "reference", contentType: "image/png", status: "available", clientVisible: true, visibility: "shared",
  downloadUrl: "http://localhost:3000/og.png", archivedAt: null,
});
batch.set(db.doc("documents/doc-uat-a-pdf"), {
  ...A, id: "doc-uat-a-pdf", tenantId, projectId: "uat-job-a", name: "Timeline notes.pdf", fileName: "timeline.pdf",
  category: "timeline", contentType: "application/pdf", status: "available", clientVisible: true, visibility: "shared",
  downloadUrl: "https://example.com/timeline-notes.pdf", archivedAt: null,
});

// Crew on Job A: an offer (accept) — and on Job E an offer to decline.
const offer = (id: string, projectId: string, projectName: string, days: number, extra: Record<string, unknown> = {}) => ({
  ...A, id, tenantId, projectId, projectName, crewProfileId: "crew-jordan", userId: crew.uid, role: "Second photographer",
  compensationCents: 90000, compensationType: "flat", currency: "USD", compensationVisibleToCrew: true,
  arrivalAt: at(days, 13), departureAt: at(days, 23),
  locations: [{ name: "Harbor View Estate", address: "40 Shore Road, Gloucester, MA" }],
  responsibilities: ["Getting ready (partner)", "Ceremony second angle", "Family formals with the lead"],
  scheduleItemIds: [], notes: null, status: "invited", invitationSentAt: nowIso, viewedAt: null, respondedAt: null,
  calendarStatus: "not_added", calendarAcknowledgedAt: null, currentScheduleId: null, currentScheduleVersion: 0,
  acknowledgedScheduleVersion: null, scheduleAcknowledgedAt: null,
  requirements: [
    { id: "schedule", name: "Read the run of show", kind: "acknowledgement", required: true, status: "missing", dueAt: null, documentId: null, completedAt: null, completedBy: null, notes: null },
    { id: "equipment", name: "Two bodies and backup cards", kind: "equipment", required: true, status: "missing", dueAt: null, documentId: null, completedAt: null, completedBy: null, notes: null },
    { id: "w9", name: "W-9", kind: "w9", required: true, status: "missing", dueAt: null, documentId: null, completedAt: null, completedBy: null, notes: null },
  ],
  inviteTokenHash: `uat-${id}`.padEnd(64, "0"), inviteExpiresAt: at(2, 17), archivedAt: null, ...extra,
});
batch.set(db.doc("crewAssignments/uat-offer-a"), offer("uat-offer-a", "uat-job-a", "Harper & Lane wedding", 25));
batch.set(db.doc("crewAssignments/uat-offer-e"), offer("uat-offer-e", "uat-job-e", "Sage & Ellis wedding", 40, {
  locations: [{ name: "Crane Estate", address: "290 Argilla Road, Ipswich, MA" }],
}));

// ---- Job B: delivered photos, album, review, crew hours owed ----------
batch.set(db.doc("deliveryRecords/del-uat-b"), {
  ...A, id: "del-uat-b", tenantId, projectId: "uat-job-b", provider: "pixieset",
  galleryUrl: "https://rowanblake.pixieset.com/wedding", accessCode: "ROWAN26", expirationDate: dateOnly(10),
  deliveryDate: dateOnly(-1), status: "delivered", sentAt: nowIso, archivedAt: null,
});
batch.set(db.doc("albumWorkflows/album-uat-b"), {
  ...A, id: "album-uat-b", tenantId, projectId: "uat-job-b", deliveryRecordId: "del-uat-b", status: "design_sent",
  instructionsUrl: "https://example.com/album-instructions", designProofUrl: "https://example.com/album-proof",
  selectionUrl: null, creativeAuthority: "studio_human", statusHistory: [], archivedAt: null,
});
batch.set(db.doc("reviewRequests/review-uat-b"), {
  ...A, id: "review-uat-b", tenantId, projectId: "uat-job-b", deliveryRecordId: "del-uat-b", channel: "email",
  destinationLabel: "Google", destinationUrl: "https://example.com/alder-muse-google-review", status: "delivered",
  sequence: 1, scheduledAt: nowIso, sentAt: nowIso, deliveredAt: nowIso, openedAt: null, clickedAt: null,
  confirmedAt: null, confirmedBy: null, messageId: null, archivedAt: null,
});
batch.set(db.doc("reviewRequests/review-uat-b-2"), {
  ...A, id: "review-uat-b-2", tenantId, projectId: "uat-job-b", deliveryRecordId: "del-uat-b", channel: "email",
  destinationLabel: "Google", destinationUrl: "https://example.com/alder-muse-google-review", status: "scheduled",
  sequence: 2, scheduledAt: at(5, 12), sentAt: null, deliveredAt: null, openedAt: null, clickedAt: null,
  confirmedAt: null, confirmedBy: null, messageId: null, archivedAt: null,
});
batch.set(db.doc("crewAssignments/uat-past-b"), offer("uat-past-b", "uat-job-b", "Rowan & Blake wedding", -8, {
  status: "accepted", respondedAt: at(-30, 12), inviteExpiresAt: at(-29, 12), currentScheduleVersion: 2, acknowledgedScheduleVersion: 2,
  locations: [{ name: "Lakeside Lodge", address: "9 Lake Street, Concord, MA" }],
  requirements: [], closeout: {}, arrivalAt: at(-8, 14), departureAt: at(-8, 22),
}));

// ---- Job C: a film -----------------------------------------------------
batch.set(db.doc("deliveryRecords/del-uat-c"), {
  ...A, id: "del-uat-c", tenantId, projectId: "uat-job-c", provider: "manual",
  galleryUrl: "https://vimeo.com/123456789", accessCode: "garden-june", expirationDate: null,
  deliveryDate: dateOnly(-2), status: "delivered", sentAt: nowIso, archivedAt: null,
});

// Crew availability: one future window to remove and undo.
batch.set(db.doc("crewAvailability/uat-away"), {
  ...A, id: "uat-away", tenantId, crewProfileId: "crew-jordan", userId: crew.uid,
  startsAt: at(8, 0), endsAt: at(10, 0), status: "unavailable", notes: "Family trip", archivedAt: null,
});
// Keep the subscription live for the length of the run.
batch.set(db.doc(`subscriptions/${tenantId}`), {
  status: "active", currentPeriodStart: at(-10, 0), currentPeriodEnd: at(30, 0),
}, { merge: true });

await batch.commit();
console.log(JSON.stringify({
  ok: true, tenantId, ownerUid: owner.uid, crewUid: crew.uid,
  couples: Object.fromEntries(Object.entries(couples).map(([k, u]) => [k, { uid: u.uid, email: u.email }])),
  jobA: dateOnly(25),
}, null, 2));
