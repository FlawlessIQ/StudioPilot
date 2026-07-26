import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
  throw new Error("Seed is restricted to Firebase emulator mode.");
}

const demoPassword = process.env.SEED_DEMO_PASSWORD;
if (!demoPassword || demoPassword.length < 12) {
  throw new Error("Set SEED_DEMO_PASSWORD to at least 12 characters before seeding.");
}

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "studiohub-dev";
const tenantId = process.env.SEED_TENANT_ID ?? `demo_${randomUUID()}`;
const packagePriceCents = Number(process.env.SEED_WEDDING_PACKAGE_CENTS);

if (!Number.isSafeInteger(packagePriceCents) || packagePriceCents <= 0) {
  throw new Error("SEED_WEDDING_PACKAGE_CENTS must be a positive integer.");
}

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({ projectId });

if (!app) {
  throw new Error("Firebase Admin did not initialize.");
}

const auth = getAuth(app);
const firestore = getFirestore(app);
const now = new Date().toISOString();

const demoUsers = [
  { key: "platform", email: "platform@studiohub.test", name: "Parker Admin", role: "platform_super_admin" },
  { key: "owner", email: "owner@studiohub.test", name: "Conor Lawless", role: "studio_owner" },
  { key: "coordinator", email: "coordinator@studiohub.test", name: "Reese Morgan", role: "studio_coordinator" },
  { key: "photographer", email: "photographer@studiohub.test", name: "Jamie Rivera", role: "staff_photographer" },
  { key: "client", email: "client@studiohub.test", name: "Maya Johnson", role: "client" },
  { key: "subcontractor", email: "crew@studiohub.test", name: "Jordan Reid", role: "subcontractor" },
] as const;

async function upsertUser(user: (typeof demoUsers)[number]) {
  try {
    return await auth.getUserByEmail(user.email);
  } catch {
    const created = await auth.createUser({
      email: user.email,
      password: demoPassword,
      displayName: user.name,
      emailVerified: true,
    });
    if (user.role === "platform_super_admin") {
      await auth.setCustomUserClaims(created.uid, { platformAdmin: true });
    }
    return created;
  }
}

const users = await Promise.all(demoUsers.map(upsertUser));
const userByKey = new Map(demoUsers.map((user, index) => [user.key, users[index]]));
const ownerId = userByKey.get("owner")?.uid;

if (!ownerId) {
  throw new Error("Demo owner could not be created.");
}

const projectSeeds = [
  { id: "wedding-lead", name: "Lena & Chris", type: "Wedding", state: "LEAD", date: "2026-10-03", readiness: 0 },
  { id: "wedding-contract", name: "Priya & Jordan", type: "Wedding", state: "CONTRACT_PENDING", date: "2026-09-19", readiness: 18 },
  { id: "wedding-booked", name: "Maya & Theo Johnson", type: "Wedding", state: "PLANNING", date: "2026-08-15", readiness: 72 },
  { id: "wedding-risk", name: "Avery & Sam", type: "Wedding", state: "PLANNING", date: "2026-08-08", readiness: 42 },
  { id: "wedding-ready", name: "Sofia & Miles Carter", type: "Wedding", state: "READY", date: "2026-08-22", readiness: 100 },
  { id: "corporate", name: "Northstar Annual Summit", type: "Corporate", state: "BOOKED", date: "2026-09-04", readiness: 46 },
  { id: "sports", name: "Hudson Valley Fall Media Day", type: "Sports", state: "CONTRACT_PENDING", date: "2026-09-12", readiness: 24 },
] as const;

const audit = {
  tenantId,
  createdAt: now,
  updatedAt: now,
  createdBy: ownerId,
  updatedBy: ownerId,
  archivedAt: null,
};

const batch = firestore.batch();
batch.set(firestore.doc(`tenants/${tenantId}`), {
  ...audit,
  id: tenantId,
  tenantId,
  slug: "alder-and-muse",
  businessName: "Alder & Muse Photography",
  legalName: "Alder & Muse Photography LLC",
  brandName: "Alder & Muse",
  timezone: "America/New_York",
  currency: "USD",
  dateFormat: "MMM d, yyyy",
  status: "trial",
  subscriptionPlan: "studio",
  defaultEventTypeId: "wedding",
  defaultLeadAssigneeId: ownerId,
});

for (let index = 0; index < demoUsers.length; index += 1) {
  const seed = demoUsers[index];
  const firebaseUser = users[index];
  if (!seed || !firebaseUser) continue;

  batch.set(firestore.doc(`users/${firebaseUser.uid}`), {
    id: firebaseUser.uid,
    tenantId: "platform",
    email: seed.email,
    displayName: seed.name,
    emailVerified: true,
    photoUrl: null,
    phone: null,
    lastLoginAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: firebaseUser.uid,
    updatedBy: firebaseUser.uid,
  });

  if (seed.role !== "platform_super_admin") {
    batch.set(firestore.doc(`memberships/${tenantId}_${firebaseUser.uid}`), {
      ...audit,
      id: `${tenantId}_${firebaseUser.uid}`,
      tenantId,
      userId: firebaseUser.uid,
      role: seed.role,
      explicitPermissions: [],
      projectIds:
        seed.role === "studio_owner" || seed.role === "studio_coordinator"
          ? projectSeeds.map((project) => project.id)
          : ["wedding-booked"],
      status: "active",
    });
  }
}

for (const project of projectSeeds) {
  const contactId = `contact-${project.id}`;
  batch.set(firestore.doc(`projects/${project.id}`), {
    ...audit,
    id: project.id,
    tenantId,
    projectId: project.id,
    name: project.name,
    eventType: project.type,
    eventTypeId: project.type.toLowerCase(),
    eventDate: project.date,
    timezone: "America/New_York",
    state: project.state,
    stateVersion: 0,
    clientContactIds: [contactId],
    leadPhotographerId: userByKey.get("photographer")?.uid ?? null,
    leadId: project.id === "wedding-lead" ? "lead-lena-chris" : null,
    packageSnapshotId:
      ["wedding-booked", "wedding-risk", "wedding-ready"].includes(project.id)
        ? `snapshot-${project.id}`
        : null,
    venueName: project.id === "wedding-booked" ? "The Foundry" : null,
    city: "New York",
    readinessScore: project.readiness,
    nextAction: project.readiness === 100 ? "Complete event-day briefing" : "Review project blockers",
    archivedAt: null,
  });

  const [firstName, ...lastNameParts] = project.name.replaceAll("&", "").split(" ").filter(Boolean);
  const lastName = lastNameParts.at(-1) ?? "Client";
  batch.set(firestore.doc(`contacts/${contactId}`), {
    ...audit,
    id: contactId,
    tenantId,
    firstName,
    lastName,
    displayName: project.name,
    email: `${project.id}@studiohub.test`,
    normalizedEmail: `${project.id}@studiohub.test`,
    phone: "+12125550110",
    normalizedPhone: "12125550110",
    company: project.type === "Wedding" ? null : project.name,
    contactTypes: ["client"],
    projectIds: [project.id],
    portalUserId: project.id === "wedding-booked" ? userByKey.get("client")?.uid ?? null : null,
    marketingConsent: false,
    notes: null,
    archivedAt: null,
  });
}

batch.set(firestore.doc("packages/signature-wedding"), {
  ...audit,
  id: "signature-wedding",
  tenantId,
  name: "The Signature Collection",
  description: "Eight hours of wedding coverage with two photographers and a complete digital gallery.",
  eventTypeId: "wedding",
  eventTypeLabel: "Wedding",
  basePriceCents: packagePriceCents,
  currency: "USD",
  retainerRule: { type: "percentage", basisPoints: 3000 },
  includedCoverageMinutes: 480,
  includedPhotographers: 2,
  includedDeliverables: ["Online gallery", "High-resolution downloads", "Printing rights"],
  includedTravelArea: "Within 50 miles of New York City",
  addOns: [
    {
      id: "engagement-session",
      name: "Engagement session",
      description: "Ninety-minute engagement portrait session.",
      unitPriceCents: 85000,
      taxable: false,
      active: true,
    },
  ],
  taxRateBasisPoints: 0,
  terms: "Coverage and deliverables are governed by the completed studio agreement.",
  active: true,
  publicVisible: true,
  displayOrder: 1,
  internalNotes: null,
  version: 1,
  archivedAt: null,
});

for (const eventType of [
  { id: "wedding", name: "Wedding Photography", category: "wedding" },
  { id: "corporate", name: "Corporate Photography", category: "corporate" },
  { id: "sports", name: "Sports Photography", category: "sports" },
] as const) {
  batch.set(firestore.doc(`eventTypeTemplates/${eventType.id}`), {
    ...audit,
    id: eventType.id,
    tenantId,
    name: eventType.name,
    slug: eventType.id,
    category: eventType.category,
    description: `${eventType.name} lifecycle and project defaults.`,
    active: true,
    requiresGuardian: eventType.category === "sports",
    displayOrder: eventType.category === "wedding" ? 1 : eventType.category === "corporate" ? 2 : 3,
    defaultWorkflowTemplateId: `${eventType.category}-v1`,
    defaultQuestionnaireTemplateId:
      eventType.category === "wedding" ? "wedding-planning-v1" : null,
    archivedAt: null,
  });
}

batch.set(firestore.doc("leads/lead-lena-chris"), {
  ...audit,
  id: "lead-lena-chris",
  tenantId,
  projectId: "wedding-lead",
  primaryContactId: "contact-wedding-lead",
  status: "new",
  eventTypeId: "wedding",
  eventTypeLabel: "Wedding",
  eventDate: "2026-10-03",
  venue: "Prospect Park Boathouse",
  city: "Brooklyn",
  estimatedGuestCount: 145,
  servicesRequested: ["photography", "engagement_session"],
  budgetRange: "$5,000–$8,000",
  referralSource: "Venue referral",
  message: "We are planning an intimate fall wedding and care most about candid documentary coverage.",
  assignedUserId: userByKey.get("coordinator")?.uid ?? ownerId,
  duplicateKey: "lena@example.test|12125550121|2026-10-03",
  duplicateOfLeadId: null,
  availabilityStatus: "unknown",
  aiSummary: null,
  missingInformation: [],
  suggestedConsultationQuestions: [],
  consentRecordedAt: now,
  source: "public_inquiry",
  archivedAt: null,
});

for (const project of projectSeeds.filter((seed) =>
  ["wedding-booked", "wedding-risk", "wedding-ready"].includes(seed.id),
)) {
  const snapshotId = `snapshot-${project.id}`;
  const basePriceCents = packagePriceCents;
  const retainerCents = Math.round(basePriceCents * 0.3);
  batch.set(firestore.doc(`packageSnapshots/${snapshotId}`), {
    id: snapshotId,
    tenantId,
    projectId: project.id,
    packageId: "signature-wedding",
    packageVersion: 1,
    packageName: "The Signature Collection",
    description: "Eight hours of wedding coverage with two photographers and a complete digital gallery.",
    currency: "USD",
    basePriceCents,
    addOns: [],
    discountCents: 0,
    subtotalCents: basePriceCents,
    taxCents: 0,
    retainerCents,
    totalCents: basePriceCents,
    includedCoverageMinutes: 480,
    includedPhotographers: 2,
    includedDeliverables: ["Online gallery", "High-resolution downloads", "Printing rights"],
    includedTravelArea: "Within 50 miles of New York City",
    terms: "Coverage and deliverables are governed by the completed studio agreement.",
    selectionDate: now,
    selectedBy: ownerId,
    immutable: true,
    createdAt: now,
    createdBy: ownerId,
  });
}

batch.set(firestore.doc("workflowTemplates/wedding-v1"), {
  ...audit,
  id: "wedding-v1",
  tenantId,
  name: "Wedding Photography",
  eventType: "Wedding",
  version: 1,
  active: true,
  checkpointTemplateIds: [
    "select-package",
    "sign-contract",
    "pay-retainer",
    "complete-questionnaire",
    "approve-schedule",
    "pay-final-invoice",
  ],
});

batch.set(firestore.doc("questionnaireTemplates/wedding-planning-v1"), {
  ...audit,
  id: "wedding-planning-v1",
  tenantId,
  name: "Wedding Planning Questionnaire",
  eventType: "Wedding",
  version: 1,
  sections: ["Couple details", "Venue", "Vendors", "Family photos", "Timeline", "Accessibility"],
});

batch.set(firestore.doc("schedules/wedding-booked-v3"), {
  ...audit,
  id: "wedding-booked-v3",
  tenantId,
  projectId: "wedding-booked",
  version: 3,
  status: "client_review",
  timezone: "America/New_York",
  publishedAt: now,
  approvedBy: null,
  immutable: true,
});

batch.set(firestore.doc("insuranceRequirements/wedding-booked"), {
  ...audit,
  id: "wedding-booked",
  tenantId,
  projectId: "wedding-booked",
  status: "under_review",
  certificateHolder: "The Foundry",
  venueAddress: "42-38 9th Street, Long Island City, NY",
  eventDate: "2026-08-15",
  humanApprovalRequired: true,
  aiApproved: false,
});

batch.set(firestore.doc("crewAssignments/wedding-booked-second"), {
  ...audit,
  id: "wedding-booked-second",
  tenantId,
  projectId: "wedding-booked",
  crewProfileId: userByKey.get("subcontractor")?.uid,
  role: "Second photographer",
  status: "accepted",
  currentScheduleVersion: 3,
  acknowledgedScheduleVersion: 2,
});

await batch.commit();

console.info(
  JSON.stringify(
    {
      message: "StudioHub demo seed complete.",
      tenantId,
      users: demoUsers.map(({ email, role }) => ({ email, role })),
    },
    null,
    2,
  ),
);
