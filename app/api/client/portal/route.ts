import { z } from "zod";
import {
  conversationIdFor,
  foldMessageIntoConversation,
  type Conversation,
} from "@/features/messaging/conversation";
import { createHash } from "node:crypto";
import type { DocumentData } from "firebase-admin/firestore";
import {
  adminAppCheck,
  adminAuth,
  adminFirestore,
} from "@/server/firebase/admin";
import { buildClientPortalExperience } from "@/server/client/portal-experience";
import { planClientProposalDecision } from "@/server/client/proposal-decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("projects"),
    tenantId: z.string().min(1).max(160),
  }),
  z.object({
    type: z.literal("records"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
    collection: z.enum([
      "proposals",
      "packageSnapshots",
      "contracts",
      "invoiceReferences",
      "questionnaireResponses",
      "schedules",
      "documents",
      "messages",
      "deliveryRecords",
      "albumWorkflows",
      "reviewRequests",
    ]),
  }),
  z.object({
    type: z.literal("project"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
  }),
  z.object({
    type: z.literal("send_message"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
    subject: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(5000),
    context: z.string().trim().max(120).nullable(),
    replyToMessageId: z.string().min(1).max(160).nullable(),
    attachments: z.array(
      z.object({
        storagePath: z.string().min(1).max(800),
        name: z.string().min(1).max(240),
        contentType: z.string().min(1).max(160),
        sizeBytes: z.number().int().positive().max(12 * 1024 * 1024),
        scanStatus: z.literal("pending"),
      }),
    ).max(5),
    idempotencyKey: z.string().min(8).max(160),
  }),
  z.object({
    type: z.literal("decide_proposal"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
    proposalId: z.string().min(1).max(160),
    decision: z.enum(["accepted", "declined"]),
    reason: z.string().trim().min(10).max(1000).nullable(),
    idempotencyKey: z.string().min(8).max(160),
  }),
  z.object({
    type: z.literal("available_packages"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
  }),
  z.object({
    type: z.literal("select_package"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
    packageId: z.string().min(1).max(160),
    selectedAddOns: z.array(
      z.object({
        addOnId: z.string().min(1).max(160),
        quantity: z.number().int().positive().max(20),
      }),
    ),
    idempotencyKey: z.string().min(8).max(160),
  }),
]);

type Membership = {
  role?: unknown;
  status?: unknown;
  projectIds?: unknown;
};

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
}

async function verifyRequest(request: Request) {
  const token = bearerToken(request);
  if (!token) throw new Error("AUTHENTICATION_REQUIRED");
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    const appCheckToken = request.headers.get("x-firebase-appcheck");
    if (!appCheckToken) throw new Error("APP_CHECK_REQUIRED");
    try {
      await adminAppCheck.verifyToken(appCheckToken);
    } catch {
      throw new Error("INVALID_APP_CHECK_TOKEN");
    }
  }
  return adminAuth.verifyIdToken(token, true);
}

async function requireClientMembership(
  uid: string,
  tenantId: string,
  projectId?: string,
) {
  const reference = adminFirestore.doc(`memberships/${tenantId}_${uid}`);
  const snapshot = await reference.get();
  const value = (snapshot.data() ?? {}) as Membership;
  const projectIds = Array.isArray(value.projectIds) ? value.projectIds : [];
  if (
    !snapshot.exists ||
    value.status !== "active" ||
    value.role !== "client" ||
    (projectId ? !projectIds.includes(projectId) : false)
  ) {
    throw new Error("PROJECT_ACCESS_DENIED");
  }
  return projectIds.filter(
    (candidate): candidate is string => typeof candidate === "string",
  );
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function pick(
  source: DocumentData,
  fields: readonly string[],
) {
  return Object.fromEntries(
    fields
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, source[field]]),
  );
}

const clientRecordFields = {
  proposals: [
    "version",
    "status",
    "eventSnapshot",
    "pricingSnapshot",
    "paymentSchedule",
    "expiresAt",
    "notes",
    "termsSummary",
    "sentAt",
    "viewedAt",
    "acceptedAt",
    "declinedAt",
    "declineReason",
    "updatedAt",
  ],
  packageSnapshots: [
    "packageName",
    "name",
    "packageVersion",
    "version",
    "selectionDate",
    "createdAt",
    "totalCents",
    "currency",
    "includedCoverageMinutes",
    "includedPhotographers",
    "includedDeliverables",
    "deliverables",
    "addOns",
    "taxCents",
    "discountCents",
    "retainerCents",
  ],
  contracts: [
    "provider",
    "status",
    "updatedAt",
    "completedAt",
    "signingUrl",
    "signers",
  ],
  invoiceReferences: [
    "kind",
    "status",
    "currency",
    "amountCents",
    "balanceCents",
    "dueDate",
    "hostedUrl",
    // The number on the client's own copy. Without it a client asking
    // "which invoice?" and a studio answering from QuickBooks are holding
    // two references that never meet.
    "providerDocNumber",
    "lastSyncedAt",
  ],
  questionnaireResponses: [
    "name",
    "templateName",
    "status",
    "answers",
    "dueDate",
    "submittedAt",
    "updatedAt",
  ],
  schedules: [
    "version",
    "status",
    "timezone",
    "items",
    "publishedAt",
    "approvedAt",
    "updatedAt",
  ],
  documents: [
    "name",
    "fileName",
    "category",
    "contentType",
    "status",
    "temporaryUrl",
    "downloadUrl",
    "updatedAt",
  ],
  messages: [
    "conversationId",
    "subject",
    "body",
    "bodyPreview",
    "context",
    "replyToMessageId",
    "attachmentReferences",
    "status",
    "direction",
    "sentAt",
    "createdAt",
    "clientReadAt",
  ],
  deliveryRecords: [
    "provider",
    "galleryUrl",
    "accessCode",
    "expirationDate",
    "deliveryDate",
    "status",
    "notes",
  ],
  albumWorkflows: [
    "deliveryRecordId",
    "status",
    "instructionsUrl",
    "selectionUrl",
    "designProofUrl",
    "creativeAuthority",
    "statusHistory",
    "updatedAt",
  ],
  reviewRequests: [
    "status",
    "channel",
    "sequence",
    "destinationLabel",
    "destinationUrl",
    "scheduledAt",
    "sentAt",
    "deliveredAt",
    "openedAt",
    "clickedAt",
    "confirmedAt",
  ],
} as const;

async function clientRecords(
  tenantId: string,
  projectId: string,
  collectionName: keyof typeof clientRecordFields,
  actorId: string,
) {
  const snapshot = await adminFirestore
    .collection(collectionName)
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .limit(100)
    .get();
  if (collectionName === "proposals") {
    await Promise.all(
      snapshot.docs
        .filter((document) => document.get("status") === "sent")
        .map((document) =>
          adminFirestore.runTransaction(async (transaction) => {
            const current = await transaction.get(document.ref);
            if (!current.exists || current.get("status") !== "sent") return;
            const now = new Date().toISOString();
            const auditId = `proposal_viewed_${createHash("sha256")
              .update(`${actorId}:${document.id}`)
              .digest("hex")
              .slice(0, 32)}`;
            transaction.update(document.ref, {
              status: "viewed",
              viewedAt: now,
              updatedAt: now,
              updatedBy: actorId,
            });
            transaction.create(adminFirestore.doc(`auditEvents/${auditId}`), {
              tenantId,
              actor: actorId,
              actorType: "client",
              action: "proposal_viewed",
              entityType: "proposal",
              entityId: document.id,
              timestamp: now,
              beforeSnapshot: { status: "sent" },
              afterSnapshot: { status: "viewed", projectId },
              correlationId: auditId,
              automationRunId: null,
              providerEventId: null,
            });
          }),
        ),
    );
  }
  if (collectionName === "messages") {
    const readAt = new Date().toISOString();
    await Promise.all(
      snapshot.docs
        .filter(
          (document) =>
            document.get("direction") === "outbound" &&
            !document.get("clientReadAt"),
        )
        .map((document) =>
          document.ref.set(
            { clientReadAt: readAt, updatedAt: readAt, updatedBy: actorId },
            { merge: true },
          ),
        ),
    );
  }
  return snapshot.docs.flatMap((document) => {
    const value = document.data();
    if (
      collectionName === "proposals" &&
      !["sent", "viewed", "accepted", "declined", "expired", "superseded"].includes(
        String(value.status),
      )
    ) {
      return [];
    }
    if (
      collectionName === "documents" &&
      (!["client", "shared"].includes(String(value.visibility)) ||
        value.clientVisible === false)
    ) {
      return [];
    }
    if (
      collectionName === "messages" &&
      !["client", "shared"].includes(String(value.visibility))
    ) {
      return [];
    }
    if (
      collectionName === "schedules" &&
      !["client_review", "approved", "published"].includes(
        String(value.status),
      )
    ) {
      return [];
    }
    const sanitized = pick(value, clientRecordFields[collectionName]);
    if (collectionName === "proposals" && sanitized.status === "sent") {
      sanitized.status = "viewed";
      sanitized.viewedAt = new Date().toISOString();
    }
    if (collectionName === "contracts" && Array.isArray(sanitized.signers)) {
      sanitized.signers = (
        sanitized.signers as Array<Record<string, unknown>>
      ).map((signer) =>
        pick(signer, ["name", "role", "order", "status", "completedAt"]),
      );
    }
    if (collectionName === "schedules" && Array.isArray(sanitized.items)) {
      sanitized.items = (
        sanitized.items as Array<Record<string, unknown>>
      )
        .filter((item) =>
          ["client", "shared"].includes(String(item.visibility ?? "shared")),
        )
        .map((item) =>
          pick(item, [
            "id",
            "startAt",
            "endAt",
            "title",
            "description",
            "location",
            "address",
            "notes",
            "visibility",
          ]),
        );
    }
    return [{ id: document.id, projectId, ...sanitized }];
  });
}

async function clientProject(tenantId: string, projectId: string) {
  const availabilityCollections = {
    proposal: "proposals",
    package: "packageSnapshots",
    contract: "contracts",
    payments: "invoiceReferences",
    questionnaire: "questionnaireResponses",
    schedule: "schedules",
    files: "documents",
    delivery: "deliveryRecords",
    reviews: "reviewRequests",
  } as const;
  const [projectSnapshot, checkpointsSnapshot, ...availabilitySnapshots] =
    await Promise.all([
    adminFirestore.doc(`projects/${projectId}`).get(),
    adminFirestore
      .collection("checkpoints")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .where("visibility", "in", ["client", "shared"])
      .limit(100)
      .get(),
    ...Object.values(availabilityCollections).map((collectionName) =>
      adminFirestore
        .collection(collectionName)
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", projectId)
        .limit(10)
        .get(),
    ),
  ]);
  if (
    !projectSnapshot.exists ||
    projectSnapshot.get("tenantId") !== tenantId
  ) {
    throw new Error("PROJECT_NOT_FOUND");
  }
  const checkpoints = checkpointsSnapshot.docs.map((document) => ({
    id: document.id,
    name: safeString(document.get("name")) ?? "Project step",
    description: safeString(document.get("description")),
    status: safeString(document.get("status")) ?? "not_started",
    dueDate: safeString(
      document.get("resolvedDueDate") ?? document.get("dueDate"),
    ),
    ownerType: safeString(document.get("ownerType")),
    actionHref: safeString(
      document.get("clientActionHref") ??
        document.get("actionHref") ??
        document.get("destinationHref"),
    ),
    actionLabel: safeString(
      document.get("clientActionLabel") ?? document.get("actionLabel"),
    ),
  }));
  const state = String(projectSnapshot.get("state") ?? "LEAD");
  const availability = Object.fromEntries(
    Object.keys(availabilityCollections).map((key, index) => {
      const collectionName =
        availabilityCollections[key as keyof typeof availabilityCollections];
      const visible = availabilitySnapshots[index].docs.some((document) => {
        const value = document.data();
        if (collectionName === "documents") {
          return (
            ["client", "shared"].includes(String(value.visibility)) &&
            value.clientVisible !== false
          );
        }
        if (collectionName === "proposals") {
          return ["sent", "viewed", "accepted", "declined"].includes(
            String(value.status),
          );
        }
        if (collectionName === "schedules") {
          return ["client_review", "approved", "published"].includes(
            String(value.status),
          );
        }
        return true;
      });
      return [key, visible];
    }),
  );
  const proposalIndex = Object.keys(availabilityCollections).indexOf("proposal");
  const currentProposal = [...availabilitySnapshots[proposalIndex].docs].sort(
    (left, right) =>
      Number(right.get("version") ?? 0) - Number(left.get("version") ?? 0),
  )[0];
  const storedProposalStatus = currentProposal
    ? String(currentProposal.get("status") ?? "")
    : null;
  const proposalStatus =
    currentProposal &&
    ["sent", "viewed"].includes(String(storedProposalStatus)) &&
    new Date(String(currentProposal.get("expiresAt") ?? "")).valueOf() <=
      Date.now()
      ? "expired"
      : storedProposalStatus;
  const experience = buildClientPortalExperience({
    state,
    availability,
    checkpoints,
    proposalStatus,
  });
  return {
    id: projectId,
    name: safeString(projectSnapshot.get("name")) ?? "Your photography project",
    eventType:
      safeString(projectSnapshot.get("eventType")) ??
      safeString(projectSnapshot.get("eventTypeName")) ??
      "Photography",
    eventDate: safeString(projectSnapshot.get("eventDate")),
    timezone: safeString(projectSnapshot.get("timezone")),
    venueName: safeString(projectSnapshot.get("venueName")),
    city: safeString(projectSnapshot.get("city")),
    leadPhotographerName: safeString(
      projectSnapshot.get("leadPhotographerName"),
    ),
    ...experience,
    clientCheckpointCount: checkpoints.length,
    checkpoints,
  };
}

async function clientProjects(tenantId: string, projectIds: string[]) {
  const snapshots = await Promise.all(
    projectIds.slice(0, 100).map((projectId) =>
      adminFirestore.doc(`projects/${projectId}`).get(),
    ),
  );
  return snapshots.flatMap((snapshot, index) => {
    if (!snapshot.exists || snapshot.get("tenantId") !== tenantId) return [];
    const state = String(snapshot.get("state") ?? "LEAD");
    return [{
      id: projectIds[index],
      name: safeString(snapshot.get("name")) ?? "Your photography project",
      eventType:
        safeString(snapshot.get("eventType")) ??
        safeString(snapshot.get("eventTypeName")) ??
        "Photography",
      eventDate: safeString(snapshot.get("eventDate")),
      venueName: safeString(snapshot.get("venueName")),
      city: safeString(snapshot.get("city")),
      clientStage: buildClientPortalExperience({
        state,
        availability: {},
        checkpoints: [],
      }).clientStage,
    }];
  });
}

async function availablePackages(tenantId: string, projectId: string) {
  const project = await adminFirestore.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId) {
    throw new Error("PROJECT_NOT_FOUND");
  }
  const snapshot = await adminFirestore
    .collection("packages")
    .where("tenantId", "==", tenantId)
    .where("eventTypeId", "==", String(project.get("eventTypeId")))
    .where("active", "==", true)
    .where("publicVisible", "==", true)
    .limit(50)
    .get();
  return snapshot.docs
    .sort(
      (left, right) =>
        Number(left.get("displayOrder") ?? 0) -
        Number(right.get("displayOrder") ?? 0),
    )
    .map((document) => ({
      id: document.id,
      name: String(document.get("name") ?? "Photography package"),
      description: safeString(document.get("description")),
      basePriceCents: Number(document.get("basePriceCents") ?? 0),
      currency: String(document.get("currency") ?? "USD"),
      includedCoverageMinutes: Number(
        document.get("includedCoverageMinutes") ?? 0,
      ),
      includedPhotographers: Number(
        document.get("includedPhotographers") ?? 0,
      ),
      includedDeliverables: Array.isArray(
        document.get("includedDeliverables"),
      )
        ? document.get("includedDeliverables")
        : [],
      addOns: Array.isArray(document.get("addOns"))
        ? (document.get("addOns") as Array<Record<string, unknown>>)
            .filter((addOn) => addOn.active === true)
            .map((addOn) =>
              pick(addOn, [
                "id",
                "name",
                "description",
                "unitPriceCents",
                "taxable",
              ]),
            )
        : [],
    }));
}

async function selectPackageForClient(input: {
  tenantId: string;
  projectId: string;
  packageId: string;
  selectedAddOns: Array<{ addOnId: string; quantity: number }>;
  idempotencyKey: string;
  actorId: string;
}) {
  const executionId = `client_package_${createHash("sha256")
    .update(
      `${input.actorId}:${input.tenantId}:${input.projectId}:${input.idempotencyKey}`,
    )
    .digest("hex")
    .slice(0, 32)}`;
  const executionReference = adminFirestore.doc(
    `commandExecutions/${executionId}`,
  );
  return adminFirestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(executionReference);
    if (existing.exists) return existing.get("result");
    const projectReference = adminFirestore.doc(
      `projects/${input.projectId}`,
    );
    const packageReference = adminFirestore.doc(
      `packages/${input.packageId}`,
    );
    const [project, studioPackage] = await Promise.all([
      transaction.get(projectReference),
      transaction.get(packageReference),
    ]);
    if (
      !project.exists ||
      project.get("tenantId") !== input.tenantId ||
      !["CONSULTATION", "PROPOSAL"].includes(String(project.get("state")))
    ) {
      throw new Error("PACKAGE_SELECTION_NOT_AVAILABLE");
    }
    if (project.get("packageSnapshotId")) {
      throw new Error("PACKAGE_ALREADY_SELECTED");
    }
    if (
      !studioPackage.exists ||
      studioPackage.get("tenantId") !== input.tenantId ||
      studioPackage.get("active") !== true ||
      studioPackage.get("publicVisible") !== true ||
      studioPackage.get("eventTypeId") !== project.get("eventTypeId")
    ) {
      throw new Error("PACKAGE_NOT_FOUND");
    }
    const addOns = Array.isArray(studioPackage.get("addOns"))
      ? (studioPackage.get("addOns") as Array<Record<string, unknown>>)
      : [];
    const selectedLines = input.selectedAddOns.map((selection) => {
      const addOn = addOns.find(
        (candidate) =>
          candidate.id === selection.addOnId && candidate.active === true,
      );
      if (!addOn) throw new Error("ADD_ON_NOT_FOUND");
      const unitPriceCents = Number(addOn.unitPriceCents ?? 0);
      return {
        addOnId: String(addOn.id),
        name: String(addOn.name),
        quantity: selection.quantity,
        unitPriceCents,
        lineTotalCents: unitPriceCents * selection.quantity,
        taxable: addOn.taxable === true,
      };
    });
    const basePriceCents = Number(studioPackage.get("basePriceCents") ?? 0);
    const addOnTotal = selectedLines.reduce(
      (total, line) => total + line.lineTotalCents,
      0,
    );
    const subtotalCents = basePriceCents + addOnTotal;
    const taxCents = Math.round(
      (subtotalCents * Number(studioPackage.get("taxRateBasisPoints") ?? 0)) /
        10000,
    );
    const totalCents = subtotalCents + taxCents;
    const retainerRule =
      (studioPackage.get("retainerRule") as
        | { type: "fixed"; amountCents: number }
        | { type: "percentage"; basisPoints: number }
        | { type: "per_crew_member"; amountPerCrewCents: number }
        | undefined) ?? { type: "fixed", amountCents: 0 };
    const retainerCents =
      retainerRule.type === "fixed"
        ? Math.min(totalCents, Number(retainerRule.amountCents))
        : retainerRule.type === "per_crew_member"
          ? Math.min(
              totalCents,
              Number(retainerRule.amountPerCrewCents) *
                Math.max(
                  1,
                  Number(studioPackage.get("includedPhotographers") ?? 1),
                ),
            )
          : Math.round((totalCents * Number(retainerRule.basisPoints)) / 10000);
    const snapshotId = `package_snapshot_${executionId}`;
    const now = new Date().toISOString();
    transaction.create(adminFirestore.doc(`packageSnapshots/${snapshotId}`), {
      id: snapshotId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      packageId: input.packageId,
      packageVersion: Number(studioPackage.get("version") ?? 1),
      packageName: String(studioPackage.get("name")),
      description: String(studioPackage.get("description") ?? ""),
      currency: String(studioPackage.get("currency") ?? "USD"),
      basePriceCents,
      addOns: selectedLines,
      discountCents: 0,
      subtotalCents,
      taxCents,
      retainerCents,
      totalCents,
      includedCoverageMinutes: Number(
        studioPackage.get("includedCoverageMinutes") ?? 0,
      ),
      includedPhotographers: Number(
        studioPackage.get("includedPhotographers") ?? 0,
      ),
      includedDeliverables: Array.isArray(
        studioPackage.get("includedDeliverables"),
      )
        ? studioPackage.get("includedDeliverables")
        : [],
      includedTravelArea: String(
        studioPackage.get("includedTravelArea") ?? "",
      ),
      terms: String(studioPackage.get("terms") ?? ""),
      selectionDate: now,
      selectedBy: input.actorId,
      immutable: true,
      createdAt: now,
      createdBy: input.actorId,
    });
    transaction.update(projectReference, {
      packageSnapshotId: snapshotId,
      state:
        project.get("state") === "CONSULTATION"
          ? "PROPOSAL"
          : project.get("state"),
      stateVersion:
        project.get("state") === "CONSULTATION"
          ? Number(project.get("stateVersion") ?? 0) + 1
          : Number(project.get("stateVersion") ?? 0),
      nextAction: "Prepare proposal",
      updatedAt: now,
      updatedBy: input.actorId,
    });
    const result = { snapshotId, totalCents, retainerCents };
    transaction.create(executionReference, {
      id: executionId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      type: "client_package_selection",
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      result,
      createdAt: now,
      completedAt: now,
    });
    transaction.create(
      adminFirestore.doc(`auditEvents/${executionId}`),
      {
        id: executionId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        actorType: "client",
        action: "package.selected",
        entityType: "packageSnapshot",
        entityId: snapshotId,
        timestamp: now,
        before: null,
        after: {
          packageId: input.packageId,
          totalCents,
          addOnCount: selectedLines.length,
        },
        correlationId: executionId,
        automationRunId: null,
        providerEventId: null,
      },
    );
    return result;
  });
}

async function decideProposal({
  tenantId,
  projectId,
  proposalId,
  decision,
  reason,
  idempotencyKey,
  actorId,
}: {
  tenantId: string;
  projectId: string;
  proposalId: string;
  decision: "accepted" | "declined";
  reason: string | null;
  idempotencyKey: string;
  actorId: string;
}) {
  const decisionId = `client_proposal_${createHash("sha256")
    .update(`${actorId}:${tenantId}:${projectId}:${proposalId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`;
  const executionReference = adminFirestore.doc(
    `commandExecutions/${decisionId}`,
  );
  const result = await adminFirestore.runTransaction(async (transaction) => {
    const projectReference = adminFirestore.doc(`projects/${projectId}`);
    const proposalReference = adminFirestore.doc(`proposals/${proposalId}`);
    const latestQuery = adminFirestore
      .collection("proposals")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .orderBy("version", "desc")
      .limit(1);

    const execution = await transaction.get(executionReference);
    if (execution.exists) {
      return execution.get("result") as {
        proposalId: string;
        status: "accepted" | "declined";
        projectState: string;
        alreadyComplete: boolean;
      };
    }

    const [project, proposal, latestProposals] = await Promise.all([
      transaction.get(projectReference),
      transaction.get(proposalReference),
      transaction.get(latestQuery),
    ]);
    if (
      !project.exists ||
      project.get("tenantId") !== tenantId ||
      !proposal.exists ||
      proposal.get("tenantId") !== tenantId ||
      proposal.get("projectId") !== projectId
    ) {
      throw new Error("PROPOSAL_NOT_FOUND");
    }
    if (latestProposals.docs[0]?.id !== proposalId) {
      throw new Error("PROPOSAL_SUPERSEDED");
    }

    const packageSnapshotId = String(
      proposal.get("packageSnapshotId") ?? "",
    );
    const packageSnapshot = await transaction.get(
      adminFirestore.doc(`packageSnapshots/${packageSnapshotId}`),
    );
    if (
      !packageSnapshot.exists ||
      packageSnapshot.get("tenantId") !== tenantId ||
      packageSnapshot.get("projectId") !== projectId
    ) {
      throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND");
    }

    const now = new Date().toISOString();
    const plan = planClientProposalDecision({
      decision,
      now,
      project: {
        state: String(project.get("state") ?? ""),
        packageSnapshotId:
          safeString(project.get("packageSnapshotId")) ?? null,
      },
      proposal: {
        status: String(proposal.get("status") ?? ""),
        expiresAt: String(proposal.get("expiresAt") ?? ""),
        packageSnapshotId,
      },
    });
    const response = {
      proposalId,
      status: plan.proposalStatus,
      projectState: plan.projectState,
      alreadyComplete: plan.alreadyComplete,
    };

    if (!plan.alreadyComplete) {
      transaction.update(proposalReference, {
        status: plan.proposalStatus,
        acceptedAt: decision === "accepted" ? now : null,
        declinedAt: decision === "declined" ? now : null,
        declineReason: decision === "declined" ? reason : null,
        decisionBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });
      if (plan.transitionProject) {
        transaction.update(projectReference, {
          packageSnapshotId,
          state: plan.projectState,
          stateVersion: Number(project.get("stateVersion") ?? 0) + 1,
          nextAction: "Prepare and send the photography agreement",
          updatedAt: now,
          updatedBy: actorId,
        });
      }

      const taskId = `proposal_decision_${proposalId}`;
      transaction.set(adminFirestore.doc(`tasks/${taskId}`), {
        id: taskId,
        tenantId,
        projectId,
        projectName:
          safeString(project.get("name")) ?? "Client photography project",
        workflowRunId: null,
        checkpointId: null,
        title:
          decision === "accepted"
            ? "Prepare client agreement"
            : "Review requested proposal changes",
        description:
          decision === "accepted"
            ? "The client accepted the current proposal. Prepare and send the contract."
            : reason ?? "The client requested changes to the current proposal.",
        assignedUserId: null,
        assignedRole: "studio_coordinator",
        dueDate: null,
        priority: decision === "accepted" ? "high" : "normal",
        status: "not_started",
        blocking: decision === "accepted",
        completedAt: null,
        completedBy: null,
        source: "client_portal",
        sourceProposalId: proposalId,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        archivedAt: null,
      });

      const proposalAuditId = `${decisionId}_proposal`;
      transaction.create(adminFirestore.doc(`auditEvents/${proposalAuditId}`), {
        tenantId,
        actor: actorId,
        actorType: "client",
        action:
          decision === "accepted"
            ? "proposal_accepted"
            : "proposal_changes_requested",
        entityType: "proposal",
        entityId: proposalId,
        timestamp: now,
        beforeSnapshot: { status: proposal.get("status") },
        afterSnapshot: {
          status: plan.proposalStatus,
          reason: decision === "declined" ? reason : null,
        },
        correlationId: decisionId,
        automationRunId: null,
        providerEventId: null,
      });
      if (plan.transitionProject) {
        transaction.create(
          adminFirestore.doc(`auditEvents/${decisionId}_state`),
          {
            tenantId,
            actor: actorId,
            actorType: "client",
            action: "project_state_changed",
            entityType: "project",
            entityId: projectId,
            timestamp: now,
            beforeSnapshot: { state: project.get("state") },
            afterSnapshot: {
              state: plan.projectState,
              reason: "Current proposal accepted by client",
            },
            correlationId: decisionId,
            automationRunId: null,
            providerEventId: null,
          },
        );
      }
    }

    transaction.create(executionReference, {
      id: decisionId,
      tenantId,
      projectId,
      type: "client_proposal_decision",
      idempotencyKey,
      actorId,
      result: response,
      createdAt: now,
      completedAt: now,
    });
    return response;
  });
  return result;
}

export async function POST(request: Request) {
  try {
    const identity = await verifyRequest(request);
    const parsed = requestSchema.parse(await request.json());
    const projectIds = await requireClientMembership(
      identity.uid,
      parsed.tenantId,
      "projectId" in parsed ? parsed.projectId : undefined,
    );

    if (parsed.type === "projects") {
      return Response.json({
        projects: await clientProjects(parsed.tenantId, projectIds),
      });
    }

    if (parsed.type === "project") {
      return Response.json(
        await clientProject(parsed.tenantId, parsed.projectId),
      );
    }

    if (parsed.type === "records") {
      return Response.json({
        records: await clientRecords(
          parsed.tenantId,
          parsed.projectId,
          parsed.collection,
          identity.uid,
        ),
      });
    }

    if (parsed.type === "available_packages") {
      return Response.json({
        packages: await availablePackages(parsed.tenantId, parsed.projectId),
      });
    }

    if (parsed.type === "select_package") {
      return Response.json(
        await selectPackageForClient({
          tenantId: parsed.tenantId,
          projectId: parsed.projectId,
          packageId: parsed.packageId,
          selectedAddOns: parsed.selectedAddOns,
          idempotencyKey: parsed.idempotencyKey,
          actorId: identity.uid,
        }),
        { status: 201 },
      );
    }

    if (parsed.type === "decide_proposal") {
      if (parsed.decision === "declined" && !parsed.reason) {
        return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
      }
      return Response.json(
        await decideProposal({
          tenantId: parsed.tenantId,
          projectId: parsed.projectId,
          proposalId: parsed.proposalId,
          decision: parsed.decision,
          reason: parsed.reason,
          idempotencyKey: parsed.idempotencyKey,
          actorId: identity.uid,
        }),
      );
    }

    const now = new Date().toISOString();
    const messageId = `client_${createHash("sha256")
      .update(`${identity.uid}:${parsed.projectId}:${parsed.idempotencyKey}`)
      .digest("hex")
      .slice(0, 32)}`;
    const taskId = `client_message_${messageId}`;
    const projectSnapshot = await adminFirestore
      .doc(`projects/${parsed.projectId}`)
      .get();
    const projectName =
      safeString(projectSnapshot.get("name")) ?? "Client project";
    const attachmentPrefix = `tenants/${parsed.tenantId}/projects/${parsed.projectId}/clients/${identity.uid}/messages/${parsed.idempotencyKey}/`;
    if (
      parsed.attachments.some(
        (attachment) => !attachment.storagePath.startsWith(attachmentPrefix),
      )
    ) {
      return Response.json({ error: "INVALID_ATTACHMENT_REFERENCE" }, { status: 400 });
    }
    // Same derivation the email worker uses, so a client's reply lands on the
    // thread the studio's message created rather than starting a new one.
    const conversationId = conversationIdFor({
      tenantId: parsed.tenantId,
      projectId: parsed.projectId,
      participant: { email: safeString(identity.email) },
    });
    const batch = adminFirestore.batch();
    batch.set(adminFirestore.doc(`messages/${messageId}`), {
      id: messageId,
      tenantId: parsed.tenantId,
      projectId: parsed.projectId,
      direction: "inbound",
      channel: "portal",
      conversationId,
      visibility: "shared",
      subject: parsed.subject,
      body: parsed.body,
      bodyPreview: parsed.body.slice(0, 240),
      context: parsed.context,
      replyToMessageId: parsed.replyToMessageId,
      attachmentReferences: parsed.attachments,
      status: "received",
      senderUserId: identity.uid,
      createdAt: now,
      updatedAt: now,
      createdBy: identity.uid,
      updatedBy: identity.uid,
      archivedAt: null,
    });
    batch.set(adminFirestore.doc(`tasks/${taskId}`), {
      id: taskId,
      tenantId: parsed.tenantId,
      projectId: parsed.projectId,
      projectName,
      workflowRunId: null,
      checkpointId: null,
      title: parsed.context
        ? `Client message received · ${parsed.context}`
        : "Client message received",
      description: `${projectName}: ${parsed.subject} — ${parsed.body.slice(0, 200)}`,
      assignedUserId: null,
      assignedRole: "studio_coordinator",
      dueDate: null,
      priority: "normal",
      status: "not_started",
      blocking: false,
      completedAt: null,
      completedBy: null,
      source: "client_portal",
      sourceMessageId: messageId,
      createdAt: now,
      updatedAt: now,
      createdBy: identity.uid,
      updatedBy: identity.uid,
      archivedAt: null,
    });
    batch.set(adminFirestore.doc(`auditEvents/${messageId}`), {
      tenantId: parsed.tenantId,
      actor: identity.uid,
      actorType: "client",
      action: "client_message_sent",
      entityType: "message",
      entityId: messageId,
      timestamp: now,
      beforeSnapshot: null,
      afterSnapshot: {
        projectId: parsed.projectId,
        channel: "portal",
        status: "received",
        studioTaskId: taskId,
        context: parsed.context,
        attachmentCount: parsed.attachments.length,
      },
      correlationId: messageId,
      automationRunId: null,
      providerEventId: null,
    });
    // Tell the studio. Until now this path wrote the message, a task, and an
    // audit event, then committed — so the only way to discover a client had
    // written was to open StudioCue and notice. The job id is derived from the
    // message id, so a retried submission cannot send a second alert.
    const tenantSnapshot = await adminFirestore
      .doc(`tenants/${parsed.tenantId}`)
      .get();
    const emailBranding = tenantSnapshot.get("emailBranding");
    const studioNotificationEmail =
      safeString(
        typeof emailBranding === "object" && emailBranding !== null
          ? (emailBranding as Record<string, unknown>).replyTo
          : null,
      ) ??
      safeString(tenantSnapshot.get("contactEmail")) ??
      safeString(tenantSnapshot.get("email"));
    if (studioNotificationEmail) {
      batch.set(adminFirestore.doc(`emailJobs/notify_${messageId}`), {
        id: `notify_${messageId}`,
        tenantId: parsed.tenantId,
        projectId: parsed.projectId,
        type: "client_message_received",
        recipient: studioNotificationEmail,
        // The signed-in portal user is the sender. Contacts are not keyed by
        // uid, so a contacts/{uid} lookup would always miss.
        senderName:
          safeString(identity.name) ?? safeString(identity.email) ?? "A client",
        messageSubject: parsed.subject,
        messagePreview: parsed.body.slice(0, 240),
        projectName,
        actionUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "")}/studio/messages`,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();
    // After the commit, and in its own transaction: two messages can land on
    // one thread at once — a client reply while a lifecycle send completes — and
    // unread counts folded from a stale read would lose one of them.
    const conversationReference = adminFirestore.doc(
      `conversations/${conversationId}`,
    );
    await adminFirestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(conversationReference);
      const next = foldMessageIntoConversation(
        snapshot.exists ? (snapshot.data() as Conversation) : null,
        {
          tenantId: parsed.tenantId,
          projectId: parsed.projectId,
          leadId: null,
          participant: {
            contactId: null,
            email: safeString(identity.email),
            phone: null,
            name: safeString(identity.name) ?? safeString(identity.email),
          },
          channel: "portal",
          direction: "inbound",
          subject: parsed.subject,
          preview: parsed.body.slice(0, 240),
          occurredAt: now,
        },
      );
      transaction.set(
        conversationReference,
        { ...next, updatedAt: now },
        { merge: true },
      );
    });
    return Response.json({ id: messageId, status: "received" }, { status: 201 });
  } catch (caught: unknown) {
    const error = caught instanceof Error ? caught.message : "REQUEST_FAILED";
    if (caught instanceof z.ZodError) {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    if (
      error === "AUTHENTICATION_REQUIRED" ||
      error === "APP_CHECK_REQUIRED" ||
      error === "INVALID_APP_CHECK_TOKEN"
    ) {
      return Response.json({ error }, { status: 401 });
    }
    if (error === "PROJECT_ACCESS_DENIED") {
      return Response.json({ error }, { status: 403 });
    }
    if (error === "PROJECT_NOT_FOUND") {
      return Response.json({ error }, { status: 404 });
    }
    if (
      error === "PROPOSAL_NOT_FOUND" ||
      error === "PACKAGE_SNAPSHOT_NOT_FOUND"
    ) {
      return Response.json({ error }, { status: 404 });
    }
    if (
      error === "PROPOSAL_NOT_ACTIONABLE" ||
      error === "PROPOSAL_EXPIRED" ||
      error === "PROPOSAL_SUPERSEDED" ||
      error === "PACKAGE_SNAPSHOT_CONFLICT" ||
      error === "PROJECT_STATE_CONFLICT" ||
      error === "PACKAGE_SELECTION_NOT_AVAILABLE" ||
      error === "PACKAGE_ALREADY_SELECTED"
    ) {
      return Response.json({ error }, { status: 409 });
    }
    console.error("Client portal request failed", caught);
    return Response.json({ error: "PORTAL_REQUEST_FAILED" }, { status: 500 });
  }
}
