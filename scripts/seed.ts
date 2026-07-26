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

const weddingCheckpointTemplates = [
  ["contract-completed", "Contract completed", "Booking", "client", -120, "contract_completed"],
  ["retainer-paid", "Retainer paid", "Booking", "client", -120, "invoice_paid"],
  ["questionnaire-complete", "Questionnaire complete", "Planning", "client", -45, "form_submitted"],
  ["venue-confirmed", "Venue confirmed", "Planning", "studio", -30, "manual"],
  ["primary-contacts", "Primary contacts confirmed", "Planning", "studio", -30, "manual"],
  ["coi-approved", "COI approved and sent", "Insurance", "studio", -21, "manual"],
  ["schedule-approved", "Final run of show approved", "Schedule", "client", -14, "schedule_approved"],
  ["final-balance", "Final balance paid", "Payments", "client", -14, "invoice_paid"],
  ["crew-accepted", "Required crew accepted", "Crew", "subcontractor", -14, "assignment_accepted"],
  ["crew-acknowledged", "Crew acknowledged current schedule", "Crew", "subcontractor", -7, "assignment_accepted"],
  ["locations-confirmed", "Locations confirmed", "Logistics", "studio", -14, "manual"],
  ["travel-confirmed", "Travel requirements confirmed", "Logistics", "studio", -14, "manual"],
  ["shot-list-approved", "Shot list approved", "Planning", "client", -14, "form_submitted"],
] as const;

const checkpointTemplate = (
  definition: (typeof weddingCheckpointTemplates)[number],
  dependencies: string[] = [],
) => ({
  key: definition[0],
  name: definition[1],
  description: `${definition[1]} must be verified before event readiness.`,
  category: definition[2],
  ownerType: definition[3],
  assignedUserId: null,
  assignedContactId: null,
  dueDateRule: {
    type: "relative",
    anchor: "event_date",
    offsetDays: definition[4],
  },
  visibility:
    definition[3] === "client"
      ? "shared"
      : definition[3] === "subcontractor"
        ? "crew"
        : "studio",
  blocking: true,
  dependencies,
  completionMethod: definition[5],
  requiredEvidence:
    definition[5] === "manual" ? ["studio approval"] : ["provider evidence"],
  reminderRules: [
    {
      daysBeforeDue: 7,
      channel: "email",
      recipient: definition[3],
    },
  ],
  escalationRules: [{ daysOverdue: 1, notifyRole: "studio_admin" }],
  waiverAllowed: true,
});

const weddingTemplates = weddingCheckpointTemplates.map((definition, index) =>
  checkpointTemplate(
    definition,
    index === 0 ? [] : [weddingCheckpointTemplates[index - 1]?.[0] ?? ""],
  ),
);
const corporateTemplates = weddingTemplates
  .filter((template) =>
    [
      "contract-completed",
      "questionnaire-complete",
      "primary-contacts",
      "schedule-approved",
      "crew-accepted",
      "locations-confirmed",
      "shot-list-approved",
    ].includes(template.key),
  )
  .map((template) => ({ ...template, dependencies: [] }));
const sportsTemplates = weddingTemplates
  .filter((template) =>
    [
      "contract-completed",
      "primary-contacts",
      "schedule-approved",
      "crew-accepted",
      "locations-confirmed",
      "shot-list-approved",
    ].includes(template.key),
  )
  .map((template) => ({ ...template, dependencies: [] }));

const bookingAutomation = {
  key: "booking-completed",
  name: "Booking completed",
  trigger: "project_status_changed",
  conditions: [{ field: "state", operator: "equals", value: "BOOKED" }],
  actions: [
    {
      key: "create-planning-task",
      type: "create_task",
      configuration: { title: "Begin project planning" },
      requiresApproval: false,
    },
  ],
  active: true,
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

for (const template of [
  {
    id: "wedding-v1",
    name: "Wedding Photography",
    description: "Complete wedding workflow from booking through readiness and review.",
    eventTypeId: "wedding",
    eventTypeLabel: "Wedding",
    checkpoints: weddingTemplates,
  },
  {
    id: "corporate-v1",
    name: "Corporate Photography",
    description: "Corporate scope, approvals, production planning, and delivery workflow.",
    eventTypeId: "corporate",
    eventTypeLabel: "Corporate",
    checkpoints: corporateTemplates,
  },
  {
    id: "sports-v1",
    name: "Sports Photography",
    description: "Organization-managed sports production with minor-safety checkpoints.",
    eventTypeId: "sports",
    eventTypeLabel: "Sports",
    checkpoints: sportsTemplates,
  },
] as const) {
  batch.set(firestore.doc(`workflowTemplates/${template.id}`), {
    ...audit,
    id: template.id,
    tenantId,
    name: template.name,
    description: template.description,
    eventTypeId: template.eventTypeId,
    eventTypeLabel: template.eventTypeLabel,
    version: 1,
    status: "active",
    checkpointTemplates: template.checkpoints,
    automationRules: [bookingAutomation],
    immutable: true,
    publishedAt: now,
    publishedBy: ownerId,
    archivedAt: null,
  });
}

const dueDateFor = (eventDate: string, offsetDays: number) => {
  const date = new Date(`${eventDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

for (const project of projectSeeds.filter((seed) =>
  ["wedding-booked", "wedding-risk", "wedding-ready", "corporate", "sports"].includes(seed.id),
)) {
  const templateId =
    project.type === "Wedding" ? "wedding-v1"
      : project.type === "Corporate" ? "corporate-v1"
        : "sports-v1";
  const templates =
    project.type === "Wedding" ? weddingTemplates
      : project.type === "Corporate" ? corporateTemplates
        : sportsTemplates;
  const runId = `workflow-run-${project.id}`;
  const completedCount =
    project.id === "wedding-ready" ? templates.length
      : project.id === "wedding-booked" ? 9
        : project.id === "wedding-risk" ? 5
          : project.id === "corporate" ? 3
            : 1;
  const checkpointIds = templates.map((template) => `${project.id}-${template.key}`);
  const checkpointDocuments = templates.map((template, index) => {
    const status = index < completedCount ? "complete" : index === completedCount ? "ready" : "not_started";
    return {
      ...audit,
      id: checkpointIds[index],
      tenantId,
      projectId: project.id,
      workflowRunId: runId,
      templateKey: template.key,
      name: template.name,
      description: template.description,
      category: template.category,
      ownerType: template.ownerType,
      assignedUserId:
        template.ownerType === "studio"
          ? userByKey.get("coordinator")?.uid ?? ownerId
          : null,
      assignedContactId:
        template.ownerType === "client" ? `contact-${project.id}` : null,
      dueDateRule: template.dueDateRule,
      resolvedDueDate: dueDateFor(project.date, template.dueDateRule.offsetDays),
      visibility: template.visibility,
      blocking: template.blocking,
      dependencyIds: template.dependencies.map((key) => `${project.id}-${key}`),
      completionMethod: template.completionMethod,
      requiredEvidence: template.requiredEvidence,
      reminderRules: template.reminderRules,
      escalationRules: template.escalationRules,
      waiverAllowed: template.waiverAllowed,
      status,
      completionTimestamp: status === "complete" ? now : null,
      completionActorId: status === "complete" ? ownerId : null,
      evidence:
        status === "complete"
          ? [{
              type: "system_rule",
              referenceId: `seed-${project.id}-${template.key}`,
              label: "Demo completion evidence",
              recordedAt: now,
              recordedBy: ownerId,
            }]
          : [],
      notes: null,
      waiverReason: null,
      waiverExpiresAt: null,
      archivedAt: null,
    };
  });
  batch.set(firestore.doc(`workflowRuns/${runId}`), {
    ...audit,
    id: runId,
    tenantId,
    projectId: project.id,
    workflowTemplateId: templateId,
    workflowVersion: 1,
    status: "active",
    inputSnapshot: {
      eventDate: project.date,
      eventTypeId: project.type.toLowerCase(),
      projectState: project.state,
      bookingDate: null,
    },
    templateSnapshot: {
      name: `${project.type} Photography`,
      description: `${project.type} project workflow snapshot.`,
      eventTypeId: project.type.toLowerCase(),
      eventTypeLabel: project.type,
      version: 1,
      checkpointTemplates: templates,
      automationRules: [bookingAutomation],
    },
    checkpointIds,
    startedAt: now,
    completedAt: null,
    failureReason: null,
    archivedAt: null,
  });
  for (const checkpoint of checkpointDocuments) {
    batch.set(firestore.doc(`checkpoints/${checkpoint.id}`), checkpoint);
  }
  const score = Math.round((completedCount / templates.length) * 100);
  const incomplete = checkpointDocuments.slice(completedCount).map((checkpoint) => ({
    checkpointId: checkpoint.id,
    name: checkpoint.name,
    status: checkpoint.status,
    ownerType: checkpoint.ownerType,
    dueDate: checkpoint.resolvedDueDate,
    reason: "Required checkpoint is incomplete",
  }));
  batch.set(firestore.doc(`readinessAssessments/${project.id}`), {
    ...audit,
    id: project.id,
    tenantId,
    projectId: project.id,
    workflowRunId: runId,
    score,
    ready: completedCount === templates.length,
    totalRequired: templates.length,
    satisfiedRequired: completedCount,
    blockingItems: incomplete,
    atRiskItems: [],
    overdueItems: project.id === "wedding-risk" ? incomplete.slice(0, 2) : [],
    recommendedNextAction:
      incomplete[0] ? `${incomplete[0].name} · ${incomplete[0].ownerType}` : "No readiness blockers",
    calculatedAt: now,
    rulesVersion: 1,
    archivedAt: null,
  });
}

for (const task of [
  {
    id: "task-johnson-schedule",
    projectId: "wedding-booked",
    title: "Review Johnson schedule comments",
    priority: "urgent",
    dueDate: now.slice(0, 10),
    blocking: true,
  },
  {
    id: "task-johnson-coi",
    projectId: "wedding-booked",
    title: "Confirm Foundry COI wording",
    priority: "high",
    dueDate: now.slice(0, 10),
    blocking: true,
  },
  {
    id: "task-northstar-shot-list",
    projectId: "corporate",
    title: "Request Northstar final shot list",
    priority: "normal",
    dueDate: "2026-07-29",
    blocking: false,
  },
] as const) {
  batch.set(firestore.doc(`tasks/${task.id}`), {
    ...audit,
    id: task.id,
    tenantId,
    projectId: task.projectId,
    workflowRunId: `workflow-run-${task.projectId}`,
    checkpointId: null,
    title: task.title,
    description: `${task.title} and record completion evidence.`,
    assignedUserId: userByKey.get("coordinator")?.uid ?? ownerId,
    assignedRole: "studio_coordinator",
    dueDate: task.dueDate,
    priority: task.priority,
    status: "not_started",
    blocking: task.blocking,
    completedAt: null,
    completedBy: null,
    archivedAt: null,
  });
}

batch.set(firestore.doc("automationRuns/demo-booking-run"), {
  ...audit,
  id: "demo-booking-run",
  tenantId,
  projectId: "wedding-booked",
  workflowRunId: "workflow-run-wedding-booked",
  workflowVersion: 1,
  automationRuleKey: "booking-completed",
  trigger: "project_status_changed",
  idempotencyKey: "demo-booking-run-wedding-booked",
  inputSnapshot: { state: "BOOKED" },
  actionTypes: ["create_task"],
  attemptCount: 1,
  status: "succeeded",
  result: { taskId: "task-johnson-schedule" },
  error: null,
  retryState: { nextAttemptAt: null, maxAttempts: 5 },
  startedAt: now,
  completedAt: now,
  manualRerunOfId: null,
  archivedAt: null,
});

batch.set(firestore.doc("auditEvents/demo-workflow-instantiated"), {
  id: "demo-workflow-instantiated",
  tenantId,
  projectId: "wedding-booked",
  actorId: ownerId,
  actorType: "user",
  action: "workflow.instantiated",
  entityType: "workflowRun",
  entityId: "workflow-run-wedding-booked",
  timestamp: now,
  before: null,
  after: { workflowVersion: 1, checkpointCount: weddingTemplates.length },
  ipAddress: null,
  userAgent: "seed",
  correlationId: "seed-workflow",
  automationRunId: null,
  providerEventId: null,
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
