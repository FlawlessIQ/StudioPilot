import { createHmac, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";

function verify(rawBody: Buffer, supplied: string | undefined, secret: string | undefined): boolean {
  if (!supplied || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const docusignPayload = z.object({
  eventId: z.string().min(1),
  event: z.string().min(1),
  accountId: z.string().min(1),
  envelopeId: z.string().min(1),
  occurredAt: z.string().datetime(),
});

export const docusignWebhook = onRequest(
  { cors: false, invoker: "private", secrets: ["DOCUSIGN_WEBHOOK_HMAC_SECRET"] },
  async (request, response) => {
    if (request.method !== "POST" || !verify(request.rawBody, request.header("x-docusign-signature-1"), process.env.DOCUSIGN_WEBHOOK_HMAC_SECRET)) {
      response.status(401).json({ error: "INVALID_SIGNATURE" });
      return;
    }
    const payload = docusignPayload.safeParse(request.body);
    if (!payload.success) {
      response.status(400).json({ error: "INVALID_PAYLOAD" });
      return;
    }
    const firestore = getFirestore();
    const eventReference = firestore.doc(`webhookEvents/docusign_${payload.data.eventId}`);
    const connections = await firestore.collection("integrationConnections")
      .where("provider", "==", "docusign")
      .where("providerAccountId", "==", payload.data.accountId)
      .limit(1)
      .get();
    const connection = connections.docs[0];
    if (!connection) {
      response.status(404).json({ error: "CONNECTION_NOT_FOUND" });
      return;
    }
    const tenantId = String(connection.get("tenantId"));
    const contracts = await firestore.collection("contracts")
      .where("tenantId", "==", tenantId)
      .where("providerEnvelopeId", "==", payload.data.envelopeId)
      .limit(1)
      .get();
    await firestore.runTransaction(async (transaction) => {
      if ((await transaction.get(eventReference)).exists) return;
      transaction.create(eventReference, { tenantId, provider: "docusign", providerEventId: payload.data.eventId, payload: payload.data, status: "processed", createdAt: new Date().toISOString() });
      const contract = contracts.docs[0];
      if (contract && payload.data.event === "envelope-completed") {
        const timestamp = new Date().toISOString();
        const projectReference = firestore.doc(
          `projects/${String(contract.get("projectId"))}`,
        );
        const project = await transaction.get(projectReference);
        transaction.update(contract.ref, {
          status: "completed",
          completedAt: payload.data.occurredAt,
          lastProviderEventId: payload.data.eventId,
          completionEvidence: { provider: "docusign", eventId: payload.data.eventId },
          updatedAt: timestamp,
          updatedBy: "docusign-webhook",
        });
        if (
          project.exists &&
          project.get("tenantId") === tenantId &&
          project.get("state") === "CONTRACT_PENDING"
        ) {
          const stateVersion = Number(project.get("stateVersion") ?? 0);
          transaction.update(projectReference, {
            state: "RETAINER_PENDING",
            stateVersion: stateVersion + 1,
            updatedAt: timestamp,
            updatedBy: "docusign-webhook",
          });
          const auditReference = firestore.doc(
            `auditEvents/docusign_contract_completed_${payload.data.eventId}`,
          );
          transaction.create(auditReference, {
            id: auditReference.id,
            tenantId,
            projectId: project.id,
            actorId: "docusign-webhook",
            actorType: "provider",
            action: "contract.completed",
            entityType: "contract",
            entityId: contract.id,
            timestamp,
            before: { projectState: "CONTRACT_PENDING", stateVersion },
            after: {
              projectState: "RETAINER_PENDING",
              stateVersion: stateVersion + 1,
            },
            ipAddress: null,
            userAgent: null,
            correlationId: payload.data.eventId,
            automationRunId: null,
            providerEventId: payload.data.eventId,
          });
        }
      }
    });
    response.status(204).send();
  },
);

const quickbooksPayload = z.object({
  eventId: z.string().min(1),
  realmId: z.string().min(1),
  invoiceId: z.string().min(1),
  status: z.enum(["sent", "partially_paid", "paid", "voided", "refunded"]),
  balanceCents: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
});

export const quickbooksWebhook = onRequest(
  { cors: false, invoker: "private", secrets: ["QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN"] },
  async (request, response) => {
    if (request.method !== "POST" || !verify(request.rawBody, request.header("intuit-signature"), process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN)) {
      response.status(401).json({ error: "INVALID_SIGNATURE" });
      return;
    }
    const payload = quickbooksPayload.safeParse(request.body);
    if (!payload.success) {
      response.status(400).json({ error: "INVALID_PAYLOAD" });
      return;
    }
    const firestore = getFirestore();
    const eventReference = firestore.doc(`webhookEvents/quickbooks_${payload.data.eventId}`);
    const connections = await firestore.collection("integrationConnections")
      .where("provider", "==", "quickbooks")
      .where("providerAccountId", "==", payload.data.realmId)
      .limit(1)
      .get();
    const connection = connections.docs[0];
    if (!connection) {
      response.status(404).json({ error: "CONNECTION_NOT_FOUND" });
      return;
    }
    const tenantId = String(connection.get("tenantId"));
    const invoices = await firestore.collection("invoiceReferences")
      .where("tenantId", "==", tenantId)
      .where("providerInvoiceId", "==", payload.data.invoiceId)
      .limit(1)
      .get();
    await firestore.runTransaction(async (transaction) => {
      if ((await transaction.get(eventReference)).exists) return;
      transaction.create(eventReference, { tenantId, provider: "quickbooks", providerEventId: payload.data.eventId, payload: payload.data, status: "processed", createdAt: new Date().toISOString() });
      const invoice = invoices.docs[0];
      if (invoice) transaction.update(invoice.ref, {
        status: payload.data.status,
        balanceCents: payload.data.balanceCents,
        lastProviderEventId: payload.data.eventId,
        lastSyncedAt: payload.data.occurredAt,
        updatedAt: new Date().toISOString(),
        updatedBy: "quickbooks-webhook",
      });
    });
    response.status(204).send();
  },
);
