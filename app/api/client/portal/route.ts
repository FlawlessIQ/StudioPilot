import { z } from "zod";
import type { DocumentData } from "firebase-admin/firestore";
import {
  adminAppCheck,
  adminAuth,
  adminFirestore,
} from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("records"),
    tenantId: z.string().min(1).max(160),
    projectId: z.string().min(1).max(160),
    collection: z.enum([
      "packageSnapshots",
      "contracts",
      "invoiceReferences",
      "questionnaireResponses",
      "schedules",
      "documents",
      "messages",
      "deliveryRecords",
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
    body: z.string().trim().min(1).max(5000),
  }),
]);

type Membership = {
  role?: unknown;
  status?: unknown;
  projectIds?: unknown;
};

const clientStages: Record<string, string> = {
  LEAD: "Getting started",
  CONSULTATION: "Consultation",
  PROPOSAL: "Reviewing your proposal",
  CONTRACT_PENDING: "Agreement",
  RETAINER_PENDING: "Booking",
  BOOKED: "Booked",
  PLANNING: "Planning",
  READY: "Ready for your event",
  EVENT_COMPLETE: "Event complete",
  POST_PRODUCTION: "Photographs in production",
  DELIVERED: "Delivered",
  REVIEW_REQUESTED: "After delivery",
  CLOSED: "Complete",
  CANCELLED: "Cancelled",
  POSTPONED: "Postponed",
  ARCHIVED: "Archived",
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
  projectId: string,
) {
  const reference = adminFirestore.doc(`memberships/${tenantId}_${uid}`);
  const snapshot = await reference.get();
  const value = (snapshot.data() ?? {}) as Membership;
  const projectIds = Array.isArray(value.projectIds) ? value.projectIds : [];
  if (
    !snapshot.exists ||
    value.status !== "active" ||
    value.role !== "client" ||
    !projectIds.includes(projectId)
  ) {
    throw new Error("PROJECT_ACCESS_DENIED");
  }
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
    "lastSyncedAt",
  ],
  questionnaireResponses: [
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
    "subject",
    "body",
    "bodyPreview",
    "status",
    "direction",
    "sentAt",
    "createdAt",
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
  reviewRequests: [
    "status",
    "destinationUrl",
    "scheduledAt",
    "sentAt",
    "deliveredAt",
    "openedAt",
    "clickedAt",
  ],
} as const;

async function clientRecords(
  tenantId: string,
  projectId: string,
  collectionName: keyof typeof clientRecordFields,
) {
  const snapshot = await adminFirestore
    .collection(collectionName)
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .limit(100)
    .get();
  return snapshot.docs.flatMap((document) => {
    const value = document.data();
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
  const [projectSnapshot, checkpointsSnapshot] = await Promise.all([
    adminFirestore.doc(`projects/${projectId}`).get(),
    adminFirestore
      .collection("checkpoints")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .where("visibility", "in", ["client", "shared"])
      .limit(100)
      .get(),
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
  }));
  const incomplete = checkpoints.find(
    (checkpoint) => !["complete", "waived"].includes(checkpoint.status),
  );
  const completeCount = checkpoints.filter((checkpoint) =>
    ["complete", "waived"].includes(checkpoint.status),
  ).length;
  const progress =
    checkpoints.length > 0
      ? Math.round((completeCount / checkpoints.length) * 100)
      : 0;
  const state = String(projectSnapshot.get("state") ?? "LEAD");
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
    clientStage: clientStages[state] ?? "In progress",
    clientProgress: progress,
    clientCheckpointCount: checkpoints.length,
    nextClientAction: incomplete
      ? {
          name: incomplete.name,
          description: incomplete.description,
          dueDate: incomplete.dueDate,
          ownerType: incomplete.ownerType,
        }
      : null,
    checkpoints,
  };
}

export async function POST(request: Request) {
  try {
    const identity = await verifyRequest(request);
    const parsed = requestSchema.parse(await request.json());
    await requireClientMembership(
      identity.uid,
      parsed.tenantId,
      parsed.projectId,
    );

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
        ),
      });
    }

    const now = new Date().toISOString();
    const messageId = crypto.randomUUID();
    const batch = adminFirestore.batch();
    batch.create(adminFirestore.doc(`messages/${messageId}`), {
      id: messageId,
      tenantId: parsed.tenantId,
      projectId: parsed.projectId,
      direction: "inbound",
      channel: "portal",
      visibility: "shared",
      subject: "Client portal message",
      body: parsed.body,
      bodyPreview: parsed.body.slice(0, 240),
      status: "received",
      senderUserId: identity.uid,
      createdAt: now,
      updatedAt: now,
      createdBy: identity.uid,
      updatedBy: identity.uid,
      archivedAt: null,
    });
    batch.create(adminFirestore.doc(`auditEvents/${crypto.randomUUID()}`), {
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
      },
      correlationId: messageId,
      automationRunId: null,
      providerEventId: null,
    });
    await batch.commit();
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
    console.error("Client portal request failed", caught);
    return Response.json({ error: "PORTAL_REQUEST_FAILED" }, { status: 500 });
  }
}
