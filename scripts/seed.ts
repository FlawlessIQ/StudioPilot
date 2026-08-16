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
  { id: "wedding-delivered", name: "Nora & James Ellis", type: "Wedding", state: "DELIVERED", date: "2026-06-20", readiness: 100 },
  { id: "wedding-post", name: "Emma & Noah Reed", type: "Wedding", state: "POST_PRODUCTION", date: "2026-06-28", readiness: 100 },
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

const scheduleConfirmationAutomation = {
  key: "schedule-confirmation-30-days",
  name: "Request the final schedule confirmation",
  trigger: "relative_date_reached",
  conditions: [
    {
      field: "relativeDateKey",
      operator: "equals",
      value: "schedule_confirmation_30_days",
    },
  ],
  actions: [
    {
      key: "send-schedule-confirmation",
      type: "send_email",
      configuration: {
        templateKey: "schedule_review",
        values: { scheduleStatus: "review" },
      },
      requiresApproval: false,
    },
  ],
  active: true,
};

const eventPreparationAutomation = {
  key: "event-preparation-1-day",
  name: "Send the day-before preparation note",
  trigger: "relative_date_reached",
  conditions: [
    {
      field: "relativeDateKey",
      operator: "equals",
      value: "event_preparation_1_day",
    },
  ],
  actions: [
    {
      key: "send-event-preparation",
      type: "send_email",
      configuration: { templateKey: "event_reminder" },
      requiresApproval: false,
    },
  ],
  active: true,
};

const weddingAutomationRules = [
  bookingAutomation,
  scheduleConfirmationAutomation,
  eventPreparationAutomation,
];

const batch = firestore.batch();
batch.set(firestore.doc(`tenants/${tenantId}`), {
  ...audit,
  id: tenantId,
  tenantId,
  slug: "alder-and-muse",
  publicSlug: "alder-and-muse",
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
  reviewLinks: {
    google: "https://example.com/alder-muse-google-review",
    weddingwire: "https://example.com/alder-muse-weddingwire-review",
    theKnot: null,
    facebook: null,
    custom: null,
  },
  deliveryDefaults: {
    galleryProvider: "pic_time",
    galleryExpirationDays: 90,
    albumInstructionsUrl:
      "https://example.com/alder-muse-album-instructions",
  },
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
          : seed.role === "subcontractor"
            ? ["wedding-booked", "wedding-ready"]
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
    automationRules:
      template.eventTypeId === "wedding"
        ? weddingAutomationRules
        : [bookingAutomation],
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
      automationRules:
        templateId === "wedding-v1"
          ? weddingAutomationRules
          : [bookingAutomation],
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

batch.set(firestore.doc("crewProfiles/crew-jordan"), {
  ...audit,
  id: "crew-jordan",
  tenantId,
  userId: userByKey.get("subcontractor")?.uid ?? null,
  name: "Jordan Reid",
  email: "crew@studiohub.test",
  phone: "+12125550145",
  specialties: ["weddings", "events"],
  serviceAreas: ["New York City", "Hudson Valley"],
  travelRadiusMiles: 75,
  rateType: "event",
  rateCents: 80000,
  currency: "USD",
  equipment: ["Dual camera bodies", "70-200mm f/2.8", "On-camera flash"],
  w9Status: "verified",
  insuranceStatus: "verified",
  contractStatus: "completed",
  emergencyContact: { name: "Alex Reid", phone: "+12125550146", relationship: "Partner" },
  notes: "Documentary wedding specialist.",
  active: true,
  archivedAt: null,
});

batch.set(firestore.doc("crewAssignments/wedding-booked-second"), {
  ...audit,
  id: "wedding-booked-second",
  tenantId,
  projectId: "wedding-booked",
  crewProfileId: "crew-jordan",
  userId: userByKey.get("subcontractor")?.uid ?? null,
  role: "Second photographer",
  compensationCents: 80000,
  compensationType: "event",
  currency: "USD",
  compensationVisibleToCrew: true,
  arrivalAt: "2026-08-15T17:15:00.000Z",
  departureAt: "2026-08-16T01:30:00.000Z",
  locations: [
    { name: "The Boro Hotel", address: "38-28 27th Street, Long Island City, NY" },
    { name: "The Foundry", address: "42-38 9th Street, Long Island City, NY" },
  ],
  responsibilities: ["Getting-ready candids", "Ceremony reactions", "Cocktail-hour coverage"],
  scheduleItemIds: ["details", "ceremony"],
  notes: "Meet lead photographer in the hotel lobby.",
  status: "accepted",
  invitationSentAt: "2026-07-20T14:00:00.000Z",
  viewedAt: "2026-07-20T14:20:00.000Z",
  respondedAt: "2026-07-20T14:22:00.000Z",
  calendarStatus: "added",
  calendarAcknowledgedAt: "2026-07-20T14:24:00.000Z",
  currentScheduleId: "wedding-booked-v4",
  currentScheduleVersion: 4,
  acknowledgedScheduleVersion: 3,
  scheduleAcknowledgedAt: "2026-07-22T12:00:00.000Z",
  requirements: [
    { id: "w9", name: "Verified W-9", kind: "w9", required: true, status: "complete", dueAt: null, documentId: "document-jordan-w9", completedAt: "2026-07-20T14:00:00.000Z", completedBy: ownerId, notes: null },
    { id: "equipment", name: "Confirm event-day equipment", kind: "equipment", required: true, status: "complete", dueAt: "2026-08-08T17:00:00.000Z", documentId: null, completedAt: "2026-07-21T14:00:00.000Z", completedBy: userByKey.get("subcontractor")?.uid ?? null, notes: null },
  ],
  inviteTokenHash: "seeded-token-not-usable".padEnd(64, "0"),
  inviteExpiresAt: "2026-07-27T14:00:00.000Z",
  archivedAt: null,
});

batch.set(firestore.doc("crewAssignments/wedding-ready-assistant"), {
  ...audit,
  id: "wedding-ready-assistant",
  tenantId,
  projectId: "wedding-ready",
  crewProfileId: "crew-jordan",
  userId: userByKey.get("subcontractor")?.uid ?? null,
  role: "Lighting assistant",
  compensationCents: 45000,
  compensationType: "event",
  currency: "USD",
  compensationVisibleToCrew: true,
  arrivalAt: "2026-08-22T18:00:00.000Z",
  departureAt: "2026-08-23T00:00:00.000Z",
  locations: [{ name: "Cedar Lakes Estate", address: "1 Team USA Way, Port Jervis, NY" }],
  responsibilities: ["Reception lighting", "Equipment management"],
  scheduleItemIds: [],
  notes: null,
  status: "invited",
  invitationSentAt: now,
  viewedAt: null,
  respondedAt: null,
  calendarStatus: "not_added",
  calendarAcknowledgedAt: null,
  currentScheduleId: null,
  currentScheduleVersion: 0,
  acknowledgedScheduleVersion: null,
  scheduleAcknowledgedAt: null,
  requirements: [
    { id: "contract", name: "Subcontractor agreement", kind: "contract", required: true, status: "complete", dueAt: null, documentId: "document-jordan-contract", completedAt: now, completedBy: ownerId, notes: null },
  ],
  inviteTokenHash: "seeded-pending-token".padEnd(64, "0"),
  inviteExpiresAt: "2026-08-02T12:00:00.000Z",
  archivedAt: null,
});

batch.set(firestore.doc("crewAvailability/crew-jordan-august-15"), {
  ...audit,
  id: "crew-jordan-august-15",
  tenantId,
  crewProfileId: "crew-jordan",
  userId: userByKey.get("subcontractor")?.uid ?? "",
  startsAt: "2026-08-15T12:00:00.000Z",
  endsAt: "2026-08-16T04:00:00.000Z",
  status: "available",
  notes: null,
  archivedAt: null,
});

batch.set(firestore.doc("packageSnapshots/snapshot-wedding-contract"), {
  id: "snapshot-wedding-contract",
  tenantId,
  projectId: "wedding-contract",
  packageId: "signature-wedding",
  packageVersion: 1,
  packageName: "The Signature Collection",
  description: "Ten hours of wedding coverage with two photographers and an engagement session.",
  currency: "USD",
  basePriceCents: packagePriceCents,
  addOns: [{ addOnId: "engagement", name: "Engagement session", quantity: 1, unitPriceCents: 65000, lineTotalCents: 65000, taxable: true }],
  discountCents: 0,
  subtotalCents: packagePriceCents + 65000,
  taxCents: 49000,
  retainerCents: 191000,
  totalCents: packagePriceCents + 114000,
  includedCoverageMinutes: 600,
  includedPhotographers: 2,
  includedDeliverables: ["Online gallery", "High-resolution downloads", "Engagement session"],
  includedTravelArea: "Within 50 miles of New York City",
  terms: "Coverage and deliverables are governed by the completed studio agreement.",
  selectionDate: now,
  selectedBy: ownerId,
  immutable: true,
  createdAt: now,
  createdBy: ownerId,
});

batch.set(firestore.doc("consultations/consultation-priya"), {
  ...audit,
  id: "consultation-priya",
  tenantId,
  projectId: "wedding-contract",
  contactId: "contact-wedding-contract",
  mode: "zoom",
  status: "completed",
  startsAt: "2026-07-24T20:00:00.000Z",
  endsAt: "2026-07-24T20:45:00.000Z",
  timezone: "America/New_York",
  location: "https://zoom.example.test/j/demo-priya",
  calendarEventId: "gcal_demo_priya",
  calendarHtmlLink: "https://calendar.example.test/gcal_demo_priya",
  meetingId: "zoom_demo_priya",
  joinUrl: "https://zoom.example.test/j/demo-priya",
  internalNotes: "Client prefers documentary coverage and minimal posing.",
  reminderJobIds: [],
  supersedesId: null,
  archivedAt: null,
});

batch.set(firestore.doc("proposals/proposal-priya-v3"), {
  ...audit,
  id: "proposal-priya-v3",
  tenantId,
  projectId: "wedding-contract",
  packageSnapshotId: "snapshot-wedding-contract",
  version: 3,
  status: "viewed",
  clientSnapshot: { displayName: "Priya Shah & Jordan Lee", email: "client@studiohub.test" },
  eventSnapshot: { name: "Priya & Jordan", eventType: "Wedding", eventDate: "2026-09-19", timezone: "America/New_York", venue: "The Foundry" },
  pricingSnapshot: {
    currency: "USD",
    packageName: "The Signature Collection",
    subtotalCents: packagePriceCents + 65000,
    discountCents: 0,
    taxCents: 49000,
    retainerCents: 191000,
    totalCents: packagePriceCents + 114000,
    lineItems: [
      { description: "Signature Collection", quantity: 1, unitPriceCents: packagePriceCents, totalCents: packagePriceCents },
      { description: "Engagement session", quantity: 1, unitPriceCents: 65000, totalCents: 65000 },
    ],
  },
  paymentSchedule: [
    { label: "Retainer", amountCents: 191000, dueDate: "2026-07-30" },
    { label: "Final balance", amountCents: packagePriceCents - 77000, dueDate: "2026-09-05" },
  ],
  expiresAt: "2026-07-31T03:59:59.000Z",
  notes: null,
  termsSummary: "Final terms are governed by the completed Docusign photography agreement.",
  pdfDocumentId: "document-proposal-priya-v3",
  sentAt: "2026-07-25T15:00:00.000Z",
  viewedAt: now,
  acceptedAt: null,
  supersedesId: "proposal-priya-v2",
  archivedAt: null,
});

batch.set(firestore.doc("contracts/contract-priya"), {
  ...audit,
  id: "contract-priya",
  tenantId,
  projectId: "wedding-contract",
  proposalId: "proposal-priya-v3",
  status: "partially_signed",
  provider: "docusign",
  providerEnvelopeId: "envelope-demo-priya",
  templateId: "wedding-agreement-v4",
  signers: [
    { name: "Priya Shah", email: "client@studiohub.test", role: "primary_client", order: 1, status: "completed" },
    { name: "Jordan Lee", email: "jordan@example.test", role: "secondary_client", order: 2, status: "sent" },
  ],
  sentAt: "2026-07-25T15:15:00.000Z",
  completedAt: null,
  signedDocumentId: null,
  certificateDocumentId: null,
  completionEvidence: null,
  fileHash: null,
  lastProviderEventId: "docusign-demo-delivered",
  archivedAt: null,
});

batch.set(firestore.doc("invoiceReferences/invoice-priya-retainer"), {
  ...audit,
  id: "invoice-priya-retainer",
  tenantId,
  projectId: "wedding-contract",
  kind: "retainer",
  provider: "quickbooks",
  providerInvoiceId: "qbo-invoice-priya-retainer",
  providerCustomerId: "qbo-customer-priya",
  status: "sent",
  currency: "USD",
  amountCents: 191000,
  balanceCents: 191000,
  dueDate: "2026-07-30",
  hostedUrl: "https://pay.example.test/qbo-invoice-priya-retainer",
  lastSyncedAt: now,
  lastProviderEventId: null,
  archivedAt: null,
});

for (const provider of ["google_calendar", "zoom", "docusign", "quickbooks", "dropbox"] as const) {
  batch.set(firestore.doc(`integrationConnections/${tenantId}_${provider}`), {
    ...audit,
    id: `${tenantId}_${provider}`,
    tenantId,
    provider,
    status: "connected",
    providerAccountId: `mock_${provider}_${tenantId}`,
    displayName: `${provider} demo connection`,
    encryptedCredentialRef: null,
    selectedResourceId: provider === "dropbox" ? "/StudioCue" : "demo-resource",
    scopes: ["development.mock"],
    connectedAt: now,
    lastHealthCheckAt: now,
    lastError: null,
    mockMode: true,
    archivedAt: null,
  });
}

batch.set(firestore.doc("questionnaireResponses/wedding-booked-planning"), {
  ...audit, id: "wedding-booked-planning", tenantId, projectId: "wedding-booked",
  templateId: "wedding-planning-v1", templateVersion: 1, status: "submitted",
  answers: { planner: "Gather & Grace", ceremonyTime: "16:30" },
  completionPercent: 100, submittedAt: now, archivedAt: null,
});
batch.set(firestore.doc("vendors/vendor-foundry"), {
  ...audit, id: "vendor-foundry", tenantId, company: "The Foundry", contactName: "Elena Cruz",
  email: "venue@example.test", phone: null, type: "venue", website: null,
  address: "42-38 9th Street, Long Island City, NY", notes: null,
  projectIds: ["wedding-booked"], archivedAt: null,
});
batch.set(firestore.doc("insuranceRequests/coi-wedding-booked"), {
  ...audit, id: "coi-wedding-booked", tenantId, projectId: "wedding-booked",
  requirementId: "wedding-booked", status: "under_review",
  replyTokenHash: "demo-reply-token-hash", inboundMessageId: "sendgrid-demo-coi",
  documentId: "document-coi-wedding-booked",
  extractedData: { certificateHolder: "The Foundry", generalLiability: 2000000 },
  discrepancies: [{ field: "additionalInsuredWording", expected: "The Foundry LLC", extracted: "The Foundry", severity: "warning" }],
  humanDecision: "pending", requestedAt: "2026-07-20T14:00:00.000Z", receivedAt: now, archivedAt: null,
});
batch.set(firestore.doc("schedules/wedding-booked-v4"), {
  ...audit, id: "wedding-booked-v4", tenantId, projectId: "wedding-booked",
  version: 4, status: "client_review", timezone: "America/New_York",
  items: [
    { id: "details", startAt: "2026-08-15T15:30:00.000Z", endAt: "2026-08-15T16:15:00.000Z", title: "Details & establishing photographs", description: "", location: "The Boro Hotel", address: null, travelMinutes: 0, photographerIds: [ownerId], participants: [], vendorContactIds: [], equipment: [], notes: null, visibility: "crew", blockingIssues: [] },
    { id: "ceremony", startAt: "2026-08-15T20:30:00.000Z", endAt: "2026-08-15T21:10:00.000Z", title: "Ceremony", description: "", location: "The Foundry", address: null, travelMinutes: 0, photographerIds: [ownerId], participants: [], vendorContactIds: ["vendor-foundry"], equipment: [], notes: null, visibility: "shared", blockingIssues: [] },
  ],
  approvalState: "client_pending", publishedAt: now, approvedBy: null,
  pdfDocumentId: null, dropboxDocumentId: null, supersedesId: "wedding-booked-v3",
  immutable: true, archivedAt: null,
});
batch.set(firestore.doc("crewScheduleViews/wedding-booked-v4_wedding-booked-second"), {
  ...audit,
  id: "wedding-booked-v4_wedding-booked-second",
  tenantId,
  projectId: "wedding-booked",
  assignmentId: "wedding-booked-second",
  userId: userByKey.get("subcontractor")?.uid ?? null,
  crewProfileId: "crew-jordan",
  sourceScheduleId: "wedding-booked-v4",
  version: 4,
  status: "published",
  timezone: "America/New_York",
  items: [
    { id: "details", startAt: "2026-08-15T15:30:00.000Z", endAt: "2026-08-15T16:15:00.000Z", title: "Details & establishing photographs", description: "", location: "The Boro Hotel", address: null, travelMinutes: 0, photographerIds: [ownerId], participants: [], vendorContactIds: [], equipment: [], notes: null, visibility: "crew", blockingIssues: [] },
    { id: "ceremony", startAt: "2026-08-15T20:30:00.000Z", endAt: "2026-08-15T21:10:00.000Z", title: "Ceremony", description: "", location: "The Foundry", address: null, travelMinutes: 0, photographerIds: [ownerId], participants: [], vendorContactIds: ["vendor-foundry"], equipment: [], notes: null, visibility: "shared", blockingIssues: [] },
  ],
  publishedAt: now,
});

const postProductionSteps = {
  backup_complete: { complete: true, completedAt: "2026-06-21T12:00:00.000Z", completedBy: ownerId, evidenceId: "backup-log-ellis", notes: null },
  cull_complete: { complete: true, completedAt: "2026-06-25T12:00:00.000Z", completedBy: ownerId, evidenceId: null, notes: null },
  editing_started: { complete: true, completedAt: "2026-06-26T12:00:00.000Z", completedBy: ownerId, evidenceId: null, notes: null },
  editing_complete: { complete: true, completedAt: "2026-07-15T12:00:00.000Z", completedBy: ownerId, evidenceId: null, notes: null },
  gallery_ready: { complete: true, completedAt: "2026-07-16T12:00:00.000Z", completedBy: ownerId, evidenceId: "gallery-ellis", notes: null },
  album_proof_ready: { complete: false, completedAt: null, completedBy: null, evidenceId: null, notes: null },
  delivery_sent: { complete: true, completedAt: "2026-07-18T14:00:00.000Z", completedBy: ownerId, evidenceId: "delivery-ellis", notes: null },
  client_downloaded: { complete: true, completedAt: "2026-07-20T16:00:00.000Z", completedBy: userByKey.get("client")?.uid ?? ownerId, evidenceId: "delivery-download-ellis", notes: null },
  project_archived: { complete: false, completedAt: null, completedBy: null, evidenceId: null, notes: null },
};
batch.set(firestore.doc("postProductionRecords/wedding-delivered"), {
  ...audit, id: "wedding-delivered", tenantId, projectId: "wedding-delivered",
  steps: postProductionSteps, currentStep: "project_archived",
  targetDeliveryDate: "2026-07-18", archivedAt: null,
});
batch.set(firestore.doc("postProductionRecords/wedding-post"), {
  ...audit, id: "wedding-post", tenantId, projectId: "wedding-post",
  steps: {
    ...postProductionSteps,
    delivery_sent: { complete: false, completedAt: null, completedBy: null, evidenceId: null, notes: null },
    client_downloaded: { complete: false, completedAt: null, completedBy: null, evidenceId: null, notes: null },
    project_archived: { complete: false, completedAt: null, completedBy: null, evidenceId: null, notes: null },
  },
  currentStep: "delivery_sent", targetDeliveryDate: "2026-07-28", archivedAt: null,
});
batch.set(firestore.doc("deliveryRecords/delivery-ellis"), {
  ...audit, id: "delivery-ellis", tenantId, projectId: "wedding-delivered",
  provider: "manual", galleryUrl: "https://gallery.example.test/nora-james",
  accessCode: "ELLIS", expirationDate: "2027-07-18", deliveryDate: "2026-07-18",
  notes: "Full wedding gallery and printing rights.", status: "downloaded",
  sentAt: "2026-07-18T14:00:00.000Z", viewedAt: "2026-07-18T15:20:00.000Z",
  downloadedAt: "2026-07-20T16:00:00.000Z", providerDeliveryId: null, archivedAt: null,
});
batch.set(firestore.doc("reviewRequests/review-ellis-1"), {
  ...audit, id: "review-ellis-1", tenantId, projectId: "wedding-delivered",
  deliveryRecordId: "delivery-ellis", channel: "email", destinationLabel: "google",
  destinationUrl: "https://example.com/alder-muse-google-review", status: "clicked",
  sequence: 1, scheduledAt: "2026-07-21T12:00:00.000Z",
  sentAt: "2026-07-21T12:00:00.000Z", deliveredAt: "2026-07-21T12:01:00.000Z",
  openedAt: "2026-07-21T14:00:00.000Z", clickedAt: "2026-07-21T14:02:00.000Z",
  confirmedAt: null, confirmedBy: null, messageId: "sendgrid-review-ellis-1", archivedAt: null,
});
batch.set(firestore.doc("reviewRequests/review-ellis-2"), {
  ...audit, id: "review-ellis-2", tenantId, projectId: "wedding-delivered",
  deliveryRecordId: "delivery-ellis", channel: "email", destinationLabel: "google",
  destinationUrl: "https://example.com/alder-muse-google-review", status: "scheduled",
  sequence: 2, scheduledAt: "2026-07-28T12:00:00.000Z",
  sentAt: null, deliveredAt: null, openedAt: null, clickedAt: null,
  confirmedAt: null, confirmedBy: null, messageId: null, archivedAt: null,
});
batch.set(firestore.doc("projectCloseouts/wedding-delivered"), {
  ...audit, id: "wedding-delivered", tenantId, projectId: "wedding-delivered", status: "blocked",
  requirements: [
    { key: "delivery", label: "Delivery sent", complete: true, evidenceId: "delivery-ellis" },
    { key: "download", label: "Client download recorded", complete: true, evidenceId: "delivery-download-ellis" },
    { key: "balance", label: "Final balance settled", complete: true, evidenceId: "invoice-final-ellis" },
    { key: "crew", label: "Crew assignments completed", complete: true, evidenceId: "crew-closeout-ellis" },
    { key: "review", label: "Review workflow resolved", complete: false, evidenceId: null },
  ],
  completedAt: null, completedBy: null, summaryDocumentId: null, archivedAt: null,
});
const studioEntitlements = {
  maxInternalUsers: 5, maxBrands: 1, maxActiveSubcontractors: null,
  aiActionsMonthly: 2500, smsEnabled: true, coiEnabled: true,
  customWorkflowsEnabled: true, advancedReportingEnabled: true,
  apiAccessEnabled: false, prioritySupportEnabled: true,
};
batch.set(firestore.doc(`subscriptions/${tenantId}`), {
  ...audit, id: tenantId, tenantId, plan: "studio", cadence: "monthly",
  status: "trialing", stripeCustomerId: "cus_mock_alder", stripeSubscriptionId: "sub_mock_alder",
  stripePriceId: "price_mock_studio_monthly", currentPeriodStart: "2026-07-01T00:00:00.000Z",
  currentPeriodEnd: "2026-08-01T00:00:00.000Z", cancelAtPeriodEnd: false,
  entitlements: studioEntitlements, internalUserCount: 3, brandCount: 1,
  activeSubcontractorCount: 3, archivedAt: null,
});
batch.set(firestore.doc(`usageCounters/${tenantId}_2026-07`), {
  ...audit, id: `${tenantId}_2026-07`, tenantId, period: "2026-07",
  aiActions: 1842, smsSegments: 326, apiRequests: 0, lastAiActionAt: now,
});
batch.set(firestore.doc("featureFlags/ai-event-copilot"), {
  ...audit, id: "ai-event-copilot", key: "ai-event-copilot", enabled: true,
  tenantIds: [tenantId], description: "Permission-aware tenant event copilot.",
  archivedAt: null,
});
for (const [component, status, failureCount] of [
  ["quickbooks", "healthy", 0], ["docusign", "healthy", 0],
  ["dropbox", "healthy", 0], ["sendgrid", "degraded", 2],
] as const) {
  batch.set(firestore.doc(`systemHealth/${tenantId}_${component}`), {
    ...audit, id: `${tenantId}_${component}`, tenantId, category: "integration",
    component, status, checkedAt: now, latencyMs: status === "healthy" ? 142 : 890,
    message: status === "healthy" ? null : "Two delayed delivery events",
    failureCount,
  });
}
batch.set(firestore.doc("providerJobs/demo-failed-sendgrid"), {
  id: "demo-failed-sendgrid", tenantId, projectId: "wedding-delivered",
  provider: "sendgrid", type: "review_request", status: "dead_letter",
  attempts: 5, error: { code: "PROVIDER_TIMEOUT", message: "Delivery event timed out", retryable: true },
  createdAt: now, updatedAt: now,
});

await batch.commit();

console.info(
  JSON.stringify(
    {
      message: "StudioCue demo seed complete.",
      tenantId,
      users: demoUsers.map(({ email, role }) => ({ email, role })),
    },
    null,
    2,
  ),
);
