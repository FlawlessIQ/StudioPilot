import { z } from "zod";
import { todayInZone } from "@/lib/format/event-date";
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
import { isStandingInvoice } from "@/features/booking/invoice-standing";

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
    type: z.literal("autopay_status"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
  }),
  z.object({
    type: z.literal("save_card"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
    /** Intuit's single-use card token. Card details never reach StudioCue. */
    cardToken: z.string().min(8).max(400),
    /** The couple ticked the consent shown by autopay_status. */
    consent: z.literal(true),
    idempotencyKey: z.string().min(8).max(160),
  }),
  z.object({
    type: z.literal("remove_card"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
    paymentMethodId: z.string().min(1).max(160),
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
    "completionAuthority",
    "status",
    "updatedAt",
    "completedAt",
    "signingUrl",
    "signers",
  ],
  invoiceReferences: [
    "kind",
    // Which accounting system this invoice actually lives in. Without it the
    // portal said "Secure payment opens in QuickBooks" to every client,
    // including a studio on Stripe and one whose retainer the studio
    // recorded by hand.
    "provider",
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
  /**
   * The run of show as it stands, so a version awaiting the couple is their
   * next action rather than a page reachable only by typing the URL. Same
   * highest-version rule as the proposal below.
   */
  const scheduleIndex = Object.keys(availabilityCollections).indexOf("schedule");
  const currentScheduleDoc = [...availabilitySnapshots[scheduleIndex].docs].sort(
    (left, right) =>
      Number(right.get("version") ?? 0) - Number(left.get("version") ?? 0),
  )[0];
  const currentSchedule = currentScheduleDoc
    ? {
        status: String(currentScheduleDoc.get("status") ?? ""),
        version: Number(currentScheduleDoc.get("version") ?? 0),
      }
    : null;
  const questionnaireIndex = Object.keys(availabilityCollections).indexOf("questionnaire");
  const questionnaireStatus =
    safeString(availabilitySnapshots[questionnaireIndex].docs[0]?.get("status")) ?? null;
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
  // What the client still owes. An invoice past its due date changes what the
  // portal should be telling them to do: the home page was pointing a couple at
  // "Review the final schedule" while their studio chased $6,265 overdue.
  const paymentsIndex = Object.keys(availabilityCollections).indexOf("payments");
  // In the job's timezone, not the container's. This ran on a UTC server, so
  // "overdue" turned over at 8pm Eastern — a couple saw their balance marked
  // late a day early, every evening.
  const todayIso = todayInZone(safeString(projectSnapshot.get("timezone")) ?? "");
  const outstandingBalance = availabilitySnapshots[paymentsIndex].docs
    .map((document) => document.data())
    .filter(
      (invoice) =>
        // A replaced or refused invoice still has a balance on it. Counting
        // one told a couple who had paid in full that they owed $569.70, and
        // pointed "Your next step" at a payment that was never theirs.
        isStandingInvoice(invoice.status) &&
        Number(invoice.balanceCents ?? 0) > 0,
    )
    .map((invoice) => {
      const dueDate = safeString(invoice.dueDate);
      return {
        balanceCents: Number(invoice.balanceCents ?? 0),
        amountLabel: new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: String(invoice.currency ?? "USD"),
        }).format(Number(invoice.balanceCents ?? 0) / 100),
        dueDate,
        // Formatted here so no raw ISO date can reach client-facing copy.
        dueDateLabel: dueDate
          ? new Intl.DateTimeFormat("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            }).format(new Date(`${dueDate}T12:00:00Z`))
          : null,
        overdue: Boolean(dueDate) && String(dueDate) < todayIso,
      };
    })
    .sort((left, right) => right.balanceCents - left.balanceCents)[0] ?? null;

  const experience = buildClientPortalExperience({
    state,
    availability,
    checkpoints,
    proposalStatus,
    outstandingBalance,
    eventDate: safeString(projectSnapshot.get("eventDate")) ?? null,
    today: todayIso,
    currentSchedule,
    questionnaireStatus,
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

const QUICKBOOKS_PAYMENTS_SCOPE = "com.intuit.quickbooks.payment";

/**
 * Autopay, as the couple sees it. Server-side so the consent wording and the
 * amount come from records, never from the browser. See
 * functions/src/billing/autopay-core.ts for the charging rules; the consent
 * text here must stay in step with autopayConsentText there.
 */
async function autopayStatus(tenantId: string, projectId: string) {
  const [tenant, connection, project, invoices, methods] = await Promise.all([
    adminFirestore.doc(`tenants/${tenantId}`).get(),
    adminFirestore.doc(`integrationConnections/${tenantId}_quickbooks`).get(),
    adminFirestore.doc(`projects/${projectId}`).get(),
    adminFirestore
      .collection("invoiceReferences")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .limit(20)
      .get(),
    adminFirestore
      .collection("paymentMethods")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .limit(20)
      .get(),
  ]);
  const autopay = (tenant.get("autopay") ?? {}) as { enabled?: unknown };
  const mock = connection.get("mockMode") === true;
  const scopes = connection.get("scopes");
  const granted =
    connection.exists &&
    connection.get("status") === "connected" &&
    (mock || (Array.isArray(scopes) && scopes.includes(QUICKBOOKS_PAYMENTS_SCOPE)));
  const rows = invoices.docs.map((document) => ({ id: document.id, ...document.data() }) as Record<string, unknown> & { id: string });
  const final = rows.find((row) => row.kind === "final" && isStandingInvoice(row.status));
  const retainer = rows.find((row) => row.kind === "retainer" && isStandingInvoice(row.status));
  const snapshotId = safeString(project.get("packageSnapshotId"));
  const snapshot = snapshotId ? await adminFirestore.doc(`packageSnapshots/${snapshotId}`).get() : null;
  const currency = String(final?.currency ?? retainer?.currency ?? snapshot?.get("currency") ?? "USD");
  const amountCents = final
    ? Number(final.balanceCents ?? 0)
    : Math.max(0, Number(snapshot?.get("totalCents") ?? 0) - Number(retainer?.amountCents ?? 0));
  const eventDate = safeString(project.get("eventDate"));
  let dueDate = safeString(final?.dueDate);
  if (!dueDate && eventDate) {
    const due = new Date(`${eventDate.slice(0, 10)}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() - 14);
    dueDate = due.toISOString().slice(0, 10);
  }
  const studioName = safeString(tenant.get("name")) ?? "Your studio";
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
  const dueText = dueDate
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${dueDate}T00:00:00Z`))
    : null;
  const method = methods.docs
    .map((document) => ({ id: document.id, ...document.data() }) as Record<string, unknown> & { id: string })
    .filter((row) => ["saving", "active", "failed"].includes(String(row.status)))
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0];
  const finalPaid = final ? Number(final.balanceCents ?? 0) <= 0 : false;
  return {
    // Offered from the deposit onward: before a deposit invoice exists there
    // is no agreed balance to consent to.
    available: autopay.enabled === true && granted && Boolean(retainer) && amountCents > 0 && !finalPaid,
    mock,
    tokenUrl: mock
      ? null
      : process.env.QUICKBOOKS_PAYMENTS_TOKEN_URL ?? "https://api.intuit.com/quickbooks/v4/payments/tokens",
    amountCents,
    currency,
    dueDate,
    consentText: `I authorise ${studioName} to charge this card ${amount} for my final balance ${dueText ? `on ${dueText}` : "when it falls due"}, and to try once more 3 days later if that charge is declined. I can remove the card before then.`,
    method: method
      ? {
          id: method.id,
          status: String(method.status),
          brand: safeString(method.brand),
          last4: safeString(method.last4),
          expMonth: safeString(method.expMonth),
          expYear: safeString(method.expYear),
          failureCode: safeString(method.failureCode),
        }
      : null,
  };
}

async function saveCard(input: {
  tenantId: string;
  projectId: string;
  cardToken: string;
  idempotencyKey: string;
  actorId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const status = await autopayStatus(input.tenantId, input.projectId);
  if (!status.available) throw new Error("AUTOPAY_UNAVAILABLE");
  const project = await adminFirestore.doc(`projects/${input.projectId}`).get();
  const contactIds = project.get("clientContactIds");
  const contactId = Array.isArray(contactIds) ? contactIds.find((value): value is string => typeof value === "string") ?? null : null;
  const id = `pm_${createHash("sha256").update(`${input.tenantId}:${input.projectId}:${input.idempotencyKey}`).digest("hex").slice(0, 28)}`;
  const reference = adminFirestore.doc(`paymentMethods/${id}`);
  const existing = await reference.get();
  if (existing.exists) return { paymentMethodId: id, status: String(existing.get("status")) };
  const now = new Date().toISOString();
  const previous = await adminFirestore
    .collection("paymentMethods")
    .where("tenantId", "==", input.tenantId)
    .where("projectId", "==", input.projectId)
    .where("status", "in", ["active", "failed", "saving"])
    .limit(10)
    .get();
  const batch = adminFirestore.batch();
  // One card per wedding: a new card replaces the old one.
  for (const document of previous.docs) {
    batch.update(document.ref, { status: "replaced", updatedAt: now, updatedBy: input.actorId });
    if (document.get("providerCardId"))
      batch.set(adminFirestore.doc(`providerJobs/card_remove_${document.id}`), {
        id: `card_remove_${document.id}`,
        tenantId: input.tenantId,
        projectId: input.projectId,
        type: "remove_quickbooks_card",
        paymentMethodId: document.id,
        idempotencyKey: `card-remove-${document.id}`,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
  }
  batch.create(reference, {
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    contactId,
    provider: "quickbooks",
    status: "saving",
    brand: null,
    last4: null,
    expMonth: null,
    expYear: null,
    providerCardId: null,
    providerCustomerId: null,
    failureCode: null,
    consent: {
      text: status.consentText,
      amountCents: status.amountCents,
      currency: status.currency,
      dueDate: status.dueDate,
      acceptedAt: now,
      acceptedBy: input.actorId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
    createdAt: now,
    updatedAt: now,
    createdBy: input.actorId,
    updatedBy: input.actorId,
  });
  batch.create(adminFirestore.doc(`providerJobs/card_save_${id}`), {
    id: `card_save_${id}`,
    tenantId: input.tenantId,
    projectId: input.projectId,
    type: "save_quickbooks_card",
    paymentMethodId: id,
    // Single-use and short-lived; the worker deletes it before using it.
    cardToken: input.cardToken,
    idempotencyKey: `card-save-${id}`,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  batch.create(adminFirestore.doc(`auditEvents/autopay_consent_${id}`), {
    id: `autopay_consent_${id}`,
    tenantId: input.tenantId,
    projectId: input.projectId,
    actorId: input.actorId,
    actorType: "client",
    action: "billing.autopay_consent_given",
    entityType: "paymentMethod",
    entityId: id,
    timestamp: now,
    before: null,
    after: { consentText: status.consentText, amountCents: status.amountCents, dueDate: status.dueDate },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    correlationId: input.idempotencyKey,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return { paymentMethodId: id, status: "saving" };
}

async function removeCard(input: { tenantId: string; projectId: string; paymentMethodId: string; actorId: string }) {
  const reference = adminFirestore.doc(`paymentMethods/${input.paymentMethodId}`);
  const method = await reference.get();
  if (!method.exists || method.get("tenantId") !== input.tenantId || method.get("projectId") !== input.projectId)
    throw new Error("PAYMENT_METHOD_NOT_FOUND");
  const now = new Date().toISOString();
  const batch = adminFirestore.batch();
  batch.update(reference, { status: "removed", removedAt: now, updatedAt: now, updatedBy: input.actorId });
  batch.set(adminFirestore.doc(`providerJobs/card_remove_${method.id}`), {
    id: `card_remove_${method.id}`,
    tenantId: input.tenantId,
    projectId: input.projectId,
    type: "remove_quickbooks_card",
    paymentMethodId: method.id,
    idempotencyKey: `card-remove-${method.id}`,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  batch.create(adminFirestore.collection("auditEvents").doc(), {
    tenantId: input.tenantId,
    projectId: input.projectId,
    actorId: input.actorId,
    actorType: "client",
    action: "billing.autopay_card_removed",
    entityType: "paymentMethod",
    entityId: method.id,
    timestamp: now,
    before: { status: method.get("status") },
    after: { status: "removed" },
    ipAddress: null,
    userAgent: null,
    correlationId: `remove_${method.id}`,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return { paymentMethodId: method.id, status: "removed" };
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

    if (parsed.type === "autopay_status") {
      return Response.json(await autopayStatus(parsed.tenantId, parsed.projectId));
    }

    if (parsed.type === "save_card") {
      return Response.json(
        await saveCard({
          tenantId: parsed.tenantId,
          projectId: parsed.projectId,
          cardToken: parsed.cardToken,
          idempotencyKey: parsed.idempotencyKey,
          actorId: identity.uid,
          ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          userAgent: request.headers.get("user-agent"),
        }),
        { status: 201 },
      );
    }

    if (parsed.type === "remove_card") {
      return Response.json(
        await removeCard({
          tenantId: parsed.tenantId,
          projectId: parsed.projectId,
          paymentMethodId: parsed.paymentMethodId,
          actorId: identity.uid,
        }),
      );
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
    let studioNotificationEmail =
      safeString(
        typeof emailBranding === "object" && emailBranding !== null
          ? (emailBranding as Record<string, unknown>).replyTo
          : null,
      ) ??
      safeString(tenantSnapshot.get("contactEmail")) ??
      safeString(tenantSnapshot.get("email"));
    // The production tenant has none of those three, so this resolved to nothing
    // and the notification was skipped in silence — the studio was never told a
    // client had written. The owner's sign-in address always exists.
    if (!studioNotificationEmail) {
      const memberships = await adminFirestore
        .collection("memberships")
        .where("tenantId", "==", parsed.tenantId)
        .limit(50)
        .get();
      for (const membership of memberships.docs) {
        if (
          String(membership.get("role")) !== "studio_owner" ||
          String(membership.get("status")) !== "active"
        ) {
          continue;
        }
        const ownerId = safeString(membership.get("userId"));
        if (!ownerId) continue;
        try {
          const owner = await adminAuth.getUser(ownerId);
          if (owner.email) {
            studioNotificationEmail = owner.email;
            break;
          }
        } catch {
          // A membership pointing at a deleted user should not stop the others.
        }
      }
    }
    if (!studioNotificationEmail) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          event: "portal.notification_address_unresolved",
          tenantId: parsed.tenantId,
          messageId,
        }),
      );
    }
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
    if (error === "AUTOPAY_UNAVAILABLE") {
      return Response.json({ error }, { status: 409 });
    }
    if (error === "PAYMENT_METHOD_NOT_FOUND") {
      return Response.json({ error }, { status: 404 });
    }
    console.error("Client portal request failed", caught);
    return Response.json({ error: "PORTAL_REQUEST_FAILED" }, { status: 500 });
  }
}
