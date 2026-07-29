import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import {
  normalizeDocusignWebhook,
  normalizeQuickBooksWebhooks,
} from "./webhook-normalizers.js";

function verify(rawBody: Buffer, supplied: string | undefined, secret: string | undefined): boolean {
  if (!supplied || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const safeEventId = (provider: string, providerEventId: string) =>
  `${provider}_${createHash("sha256").update(providerEventId).digest("hex")}`;

export const docusignWebhook = onRequest(
  { cors: false, invoker: "private", secrets: ["DOCUSIGN_WEBHOOK_HMAC_SECRET"] },
  async (request, response) => {
    if (request.method !== "POST" || !verify(request.rawBody, request.header("x-docusign-signature-1"), process.env.DOCUSIGN_WEBHOOK_HMAC_SECRET)) {
      response.status(401).json({ error: "INVALID_SIGNATURE" });
      return;
    }
    const event = normalizeDocusignWebhook(request.body);
    if (!event) {
      response.status(400).json({ error: "INVALID_PAYLOAD" });
      return;
    }
    const firestore = getFirestore();
    const eventReference = firestore.doc(
      `webhookEvents/${safeEventId("docusign", event.providerEventId)}`,
    );
    const connections = await firestore.collection("integrationConnections")
      .where("provider", "==", "docusign")
      .where("providerAccountId", "==", event.accountId)
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
      .where("providerEnvelopeId", "==", event.envelopeId)
      .limit(1)
      .get();
    await firestore.runTransaction(async (transaction) => {
      if ((await transaction.get(eventReference)).exists) return;
      transaction.create(eventReference, {
        tenantId,
        provider: "docusign",
        providerEventId: event.providerEventId,
        payload: {
          event: event.event,
          accountId: event.accountId,
          envelopeId: event.envelopeId,
          occurredAt: event.occurredAt,
        },
        status: "processed",
        createdAt: new Date().toISOString(),
      });
      const contract = contracts.docs[0];
      if (contract && event.event === "envelope-completed") {
        const timestamp = new Date().toISOString();
        const projectReference = firestore.doc(
          `projects/${String(contract.get("projectId"))}`,
        );
        const project = await transaction.get(projectReference);
        transaction.update(contract.ref, {
          status: "completed",
          completedAt: event.occurredAt,
          lastProviderEventId: event.providerEventId,
          completionEvidence: {
            provider: "docusign",
            eventId: event.providerEventId,
          },
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
            `auditEvents/docusign_contract_completed_${createHash("sha256").update(event.providerEventId).digest("hex")}`,
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
            correlationId: event.providerEventId,
            automationRunId: null,
            providerEventId: event.providerEventId,
          });
        }
      }
    });
    response.status(204).send();
  },
);

export const quickbooksWebhook = onRequest(
  { cors: false, invoker: "private", secrets: ["QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN"] },
  async (request, response) => {
    if (request.method !== "POST" || !verify(request.rawBody, request.header("intuit-signature"), process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN)) {
      response.status(401).json({ error: "INVALID_SIGNATURE" });
      return;
    }
    const events = normalizeQuickBooksWebhooks(request.body);
    if (events.length === 0) {
      response.status(400).json({ error: "INVALID_PAYLOAD" });
      return;
    }
    const firestore = getFirestore();
    for (const event of events) {
      const eventId = safeEventId("quickbooks", event.providerEventId);
      const eventReference = firestore.doc(`webhookEvents/${eventId}`);
      const connections = await firestore.collection("integrationConnections")
        .where("provider", "==", "quickbooks")
        .where("providerAccountId", "==", event.realmId)
        .limit(1)
        .get();
      const connection = connections.docs[0];
      if (!connection) {
        console.warn("quickbooks_webhook_connection_not_found", {
          providerEventId: event.providerEventId,
          realmId: event.realmId,
        });
        continue;
      }
      const tenantId = String(connection.get("tenantId"));
      const invoices = event.entityName === "invoice"
        ? await firestore.collection("invoiceReferences")
          .where("tenantId", "==", tenantId)
          .where("providerInvoiceId", "==", event.entityId)
          .limit(1)
          .get()
        : null;
      const invoice = invoices?.docs[0];
      const jobReference = invoice
        ? firestore.doc(`providerJobs/quickbooks_reconcile_${createHash("sha256").update(event.providerEventId).digest("hex")}`)
        : null;

      await firestore.runTransaction(async (transaction) => {
        if ((await transaction.get(eventReference)).exists) return;
        const now = new Date().toISOString();
        const status = invoice && jobReference ? "queued" : "ignored";
        transaction.create(eventReference, {
          tenantId,
          provider: "quickbooks",
          providerEventId: event.providerEventId,
          payload: {
            realmId: event.realmId,
            entityName: event.entityName,
            entityId: event.entityId,
            operation: event.operation,
            occurredAt: event.occurredAt,
          },
          status,
          ignoredReason: status === "ignored"
            ? event.entityName !== "invoice"
              ? "UNSUPPORTED_ENTITY"
              : "INVOICE_NOT_TRACKED"
            : null,
          createdAt: now,
        });
        if (invoice && jobReference) {
          transaction.create(jobReference, {
            id: jobReference.id,
            tenantId,
            invoiceId: invoice.id,
            providerInvoiceId: event.entityId,
            realmId: event.realmId,
            operation: event.operation,
            occurredAt: event.occurredAt,
            webhookEventId: eventId,
            type: "reconcile_quickbooks_invoice",
            idempotencyKey: event.providerEventId,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
      });
    }
    response.status(200).json({ accepted: events.length });
  },
);
