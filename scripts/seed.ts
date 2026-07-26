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
  businessName: "Alder & Muse Photography",
  legalName: "Alder & Muse Photography LLC",
  brandName: "Alder & Muse",
  timezone: "America/New_York",
  currency: "USD",
  dateFormat: "MMM d, yyyy",
  status: "trial",
  subscriptionPlan: "studio",
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
  batch.set(firestore.doc(`projects/${project.id}`), {
    ...audit,
    id: project.id,
    tenantId,
    projectId: project.id,
    name: project.name,
    eventType: project.type,
    eventDate: project.date,
    timezone: "America/New_York",
    state: project.state,
    clientContactIds: [`contact-${project.id}`],
    leadPhotographerId: userByKey.get("photographer")?.uid ?? null,
    readiness: project.readiness,
  });
}

batch.set(firestore.doc("packages/signature-wedding"), {
  ...audit,
  id: "signature-wedding",
  tenantId,
  name: "The Signature Collection",
  eventType: "Wedding",
  basePriceCents: packagePriceCents,
  currency: "USD",
  retainerType: "percentage",
  retainerValue: 30,
  coverageHours: 8,
  includedPhotographers: 2,
  includedDeliverables: ["Online gallery", "High-resolution downloads", "Printing rights"],
  active: true,
  version: 1,
});

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
