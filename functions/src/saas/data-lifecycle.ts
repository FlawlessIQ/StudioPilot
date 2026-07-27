import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("requestExport"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
  }),
  z.object({
    type: z.literal("requestDeletion"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    reason: z.string().min(10).max(2000),
    confirmation: z.string().min(2),
  }),
  z.object({
    type: z.literal("cancelDeletion"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    requestId: z.string().min(1),
  }),
]);
const collections = [
  "contacts",
  "leads",
  "projects",
  "eventTypeTemplates",
  "packages",
  "packageSnapshots",
  "proposals",
  "contracts",
  "invoiceReferences",
  "questionnaireTemplates",
  "questionnaireResponses",
  "workflowTemplates",
  "workflowRuns",
  "checkpoints",
  "tasks",
  "schedules",
  "vendors",
  "insuranceRequirements",
  "insuranceRequests",
  "crewProfiles",
  "crewAssignments",
  "documents",
  "messages",
  "automationRuns",
  "auditEvents",
  "reviewRequests",
  "deliveryRecords",
  "postProductionRecords",
  "projectCloseouts",
  "subscriptions",
  "usageCounters",
  "integrationConnections",
];
const stable = (tenantId: string, key: string) =>
  createHash("sha256").update(`${tenantId}:${key}`).digest("hex").slice(0, 40);
async function owner(tenantId: string, userId: string) {
  const membership = await getFirestore()
    .doc(`memberships/${tenantId}_${userId}`)
    .get();
  if (
    !membership.exists ||
    membership.get("status") !== "active" ||
    membership.get("role") !== "studio_owner"
  )
    throw new Error("FORBIDDEN");
}

export const tenantDataCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const parsed = command.parse(request.body);
      await owner(parsed.tenantId, identity.uid);
      const db = getFirestore();
      const now = new Date().toISOString();
      const id = stable(parsed.tenantId, parsed.idempotencyKey);
      if (parsed.type === "requestExport") {
        const reference = db.doc(`exportJobs/${id}`);
        if (!(await reference.get()).exists)
          await reference.create({
            id,
            tenantId: parsed.tenantId,
            requestedBy: identity.uid,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        response.status(200).json({ exportJobId: id, status: "queued" });
        return;
      }
      if (parsed.type === "requestDeletion") {
        const tenant = await db.doc(`tenants/${parsed.tenantId}`).get();
        if (parsed.confirmation !== String(tenant.get("businessName")))
          throw new Error("BUSINESS_NAME_CONFIRMATION_REQUIRED");
        const deleteAfter = new Date(Date.now() + 30 * 86400000).toISOString();
        const reference = db.doc(`deletionRequests/${id}`);
        if (!(await reference.get()).exists)
          await reference.create({
            id,
            tenantId: parsed.tenantId,
            requestedBy: identity.uid,
            reason: parsed.reason,
            status: "cooling_off",
            deleteAfter,
            platformApprovedAt: null,
            cancelledAt: null,
            createdAt: now,
            updatedAt: now,
          });
        response
          .status(200)
          .json({ deletionRequestId: id, status: "cooling_off", deleteAfter });
        return;
      }
      const reference = db.doc(`deletionRequests/${parsed.requestId}`);
      const current = await reference.get();
      if (
        !current.exists ||
        current.get("tenantId") !== parsed.tenantId ||
        !["cooling_off", "platform_approved"].includes(
          String(current.get("status")),
        )
      )
        throw new Error("DELETION_REQUEST_NOT_CANCELLABLE");
      await reference.update({
        status: "cancelled",
        cancelledAt: now,
        updatedAt: now,
      });
      response
        .status(200)
        .json({ deletionRequestId: parsed.requestId, status: "cancelled" });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "DATA_COMMAND_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);

async function tenantCollection(name: string, tenantId: string) {
  const db = getFirestore();
  const values: unknown[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  do {
    let query: FirebaseFirestore.Query = db
      .collection(name)
      .where("tenantId", "==", tenantId)
      .orderBy("__name__")
      .limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    values.push(
      ...snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })),
    );
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < 500) break;
  } while (cursor);
  return values;
}
async function createExport(job: FirebaseFirestore.QueryDocumentSnapshot) {
  const db = getFirestore();
  const tenantId = String(job.get("tenantId"));
  const payload: Record<string, unknown[]> = {};
  for (const name of collections)
    payload[name] = await tenantCollection(name, tenantId);
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  payload.tenants = [{ id: tenant.id, ...tenant.data() }];
  payload.memberships = await tenantCollection("memberships", tenantId);
  const bytes = gzipSync(
    Buffer.from(
      JSON.stringify({
        format: "studiohub-tenant-export-v1",
        generatedAt: new Date().toISOString(),
        tenantId,
        data: payload,
      }),
    ),
  );
  const path = `tenants/${tenantId}/exports/${job.id}.json.gz`;
  await getStorage()
    .bucket()
    .file(path)
    .save(bytes, {
      contentType: "application/gzip",
      resumable: false,
      metadata: {
        metadata: { scanStatus: "clean", trustedGenerator: "studiohub-export" },
      },
    });
  await job.ref.update({
    status: "complete",
    path,
    sizeBytes: bytes.length,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}
export const tenantExportScheduler = onSchedule(
  { schedule: "every 5 minutes", timeZone: "UTC", retryCount: 0 },
  async () => {
    const jobs = await getFirestore()
      .collection("exportJobs")
      .where("status", "==", "queued")
      .limit(5)
      .get();
    for (const job of jobs.docs) {
      try {
        await job.ref.update({
          status: "running",
          attempts: Number(job.get("attempts") ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        });
        await createExport(job);
      } catch (caught: unknown) {
        const current = await job.ref.get();
        const attempts = Number(current.get("attempts") ?? 1);
        await job.ref.update({
          status: attempts >= 3 ? "failed" : "queued",
          error: caught instanceof Error ? caught.message : "EXPORT_FAILED",
          updatedAt: new Date().toISOString(),
        });
      }
    }
  },
);

export const tenantExportDownload = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
  },
  async (request, response) => {
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const id = String(request.query.id ?? "");
      const job = await getFirestore().doc(`exportJobs/${id}`).get();
      if (!job.exists || job.get("status") !== "complete")
        throw new Error("EXPORT_NOT_READY");
      await owner(String(job.get("tenantId")), identity.uid);
      const [url] = await getStorage()
        .bucket()
        .file(String(job.get("path")))
        .getSignedUrl({ action: "read", expires: Date.now() + 15 * 60000 });
      response.status(200).json({ url, expiresInSeconds: 900 });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "EXPORT_DOWNLOAD_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
