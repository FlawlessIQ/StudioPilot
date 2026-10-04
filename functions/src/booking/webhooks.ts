import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { signatureValid } from "../saas/stripe.js";
import { providerReportedInvoice } from "./invoice-standing.js";
import { stripePaymentFailureFields } from "./payment-failure.js";
import { QUICKBOOKS_MONEY_ENTITIES, RECONCILE_MONEY_EVENT_JOB } from "./quickbooks-money-events-core.js";
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
    /**
     * Every read before every write, which Firestore requires and this did not
     * do. The completion branch called `transaction.get` on the project *after*
     * creating the event record, so the transaction threw "Firestore
     * transactions require all reads to be executed before all writes" and the
     * handler answered 500.
     *
     * That is not a rare edge: it is what happens whenever a completed envelope
     * matches a contract, which is the only case that matters. Docusign retries
     * a non-2xx, gets another 500, and eventually gives up — so a signed
     * agreement never reached `completed`, the project never left
     * CONTRACT_PENDING, and the booking gate could never open. It went unseen
     * because the earlier failure modes are all before this point: without a
     * connected account the handler answers 404 first.
     *
     * Found by scripts/certify-providers.ts on 2026-08-30.
     */
    const contract = contracts.docs[0];
    const projectReference = contract
      ? firestore.doc(`projects/${String(contract.get("projectId"))}`)
      : null;
    await firestore.runTransaction(async (transaction) => {
      const [existing, project] = await Promise.all([
        transaction.get(eventReference),
        projectReference ? transaction.get(projectReference) : null,
      ]);
      if (existing.exists) return;
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
      if (contract && projectReference && project && event.event === "envelope-completed") {
        const timestamp = new Date().toISOString();
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

// Dropbox Sign's callback endpoint was retired on 2026-10-04: native
// signing replaced it and Dropbox Sign is not an offered integration
// (features/integrations/schema.ts), so the endpoint only widened the surface.

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
      // Money moving back: a payment deleted or voided, a credit memo, a
      // refund. These were "ignored / UNSUPPORTED_ENTITY" until 2026-10-01
      // (quickbooks-money-events-core.ts); the worker finds the invoices.
      const moneyJobReference = QUICKBOOKS_MONEY_ENTITIES.has(event.entityName)
        ? firestore.doc(`providerJobs/quickbooks_money_${createHash("sha256").update(event.providerEventId).digest("hex")}`)
        : null;

      await firestore.runTransaction(async (transaction) => {
        if ((await transaction.get(eventReference)).exists) return;
        const now = new Date().toISOString();
        const status = (invoice && jobReference) || moneyJobReference ? "queued" : "ignored";
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
        if (moneyJobReference) {
          transaction.create(moneyJobReference, {
            id: moneyJobReference.id,
            tenantId,
            projectId: null,
            entityName: event.entityName,
            entityId: event.entityId,
            realmId: event.realmId,
            operation: event.operation,
            occurredAt: event.occurredAt,
            webhookEventId: eventId,
            type: RECONCILE_MONEY_EVENT_JOB,
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

const stripeConnectEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  account: z.string().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

// Connect events (studios' own client invoices) are delivered to a
// separate endpoint from saas/stripe.ts's stripeWebhook, which only ever
// carries platform-level subscription events for StudioCue's own Stripe
// account. Connect webhook events carry a top-level "account" field
// identifying which connected account (studio) the event is for — that's
// how the two are told apart, and why this needs its own signing secret
// (STRIPE_CONNECT_WEBHOOK_SECRET) registered separately in the Stripe
// dashboard's Connect webhook settings. Reuses the same signature scheme
// saas/stripe.ts already implements (and exports) since Stripe signs both
// kinds of webhook identically.
export const stripeConnectWebhook = onRequest(
  { cors: false, invoker: "private", secrets: ["STRIPE_CONNECT_WEBHOOK_SECRET"] },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("METHOD_NOT_ALLOWED");
      return;
    }
    const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const header = request.header("stripe-signature");
    const raw = request.rawBody.toString("utf8");
    if (!secret || !header || !signatureValid(raw, header, secret)) {
      response.status(401).send("INVALID_SIGNATURE");
      return;
    }
    const parsed = stripeConnectEventSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      response.status(400).send("INVALID_PAYLOAD");
      return;
    }
    const event = parsed.data;
    const firestore = getFirestore();
    const eventReference = firestore.doc(
      `webhookEvents/${safeEventId("stripe_connect", event.id)}`,
    );
    if ((await eventReference.get()).exists) {
      response.status(200).json({ received: true, duplicate: true });
      return;
    }
    const accountId = event.account ?? "";
    const connections = accountId
      ? await firestore.collection("integrationConnections")
        .where("provider", "==", "stripe")
        .where("providerAccountId", "==", accountId)
        .limit(1)
        .get()
      : null;
    const connection = connections?.docs[0];
    const tenantId = connection ? String(connection.get("tenantId")) : null;
    const object = event.data.object;
    const supported = [
      "invoice.paid",
      "invoice.payment_failed",
      "invoice.voided",
    ].includes(event.type);
    const stripeInvoiceId = typeof object.id === "string" ? object.id : "";
    const invoices = tenantId && supported && stripeInvoiceId
      ? await firestore.collection("invoiceReferences")
        .where("tenantId", "==", tenantId)
        .where("providerInvoiceId", "==", stripeInvoiceId)
        .limit(1)
        .get()
      : null;
    const invoice = invoices?.docs[0];
    await firestore.runTransaction(async (transaction) => {
      if ((await transaction.get(eventReference)).exists) return;
      const current = invoice ? await transaction.get(invoice.ref) : null;
      const now = new Date().toISOString();
      transaction.create(eventReference, {
        tenantId,
        provider: "stripe",
        providerEventId: event.id,
        payload: { type: event.type, accountId, stripeInvoiceId },
        status: invoice ? "processed" : "ignored",
        createdAt: now,
      });
      if (!invoice) return;
      const amountRemaining = Number(object.amount_remaining ?? 0);
      const amountPaid = Number(object.amount_paid ?? 0);
      // A payment recorded outside Stripe reaches it as a credit note
      // (booking/invoice-payments.ts), which lowers what is left without
      // being a payment: part paid all the same.
      const credited = Number(object.pre_payment_credit_notes_amount ?? 0);
      const reported = event.type === "invoice.voided"
        ? "voided"
        : amountRemaining === 0
          ? "paid"
          : amountPaid > 0 || credited > 0
            ? "partially_paid"
            : "sent";
      // A payment the studio recorded by hand, or a bill StudioCue closed, is
      // not reopened by a `payment_failed` on an invoice Stripe never saw
      // paid. Only Stripe's own paid or voided wins (invoice-standing.ts).
      const decided = providerReportedInvoice({
        current: {
          status: current?.get("status"),
          completionAuthority: current?.get("completionAuthority"),
          balanceCents: current?.get("balanceCents"),
          studioPayments: current?.get("studioPayments"),
        },
        reported: { status: reported, balanceCents: Math.max(0, amountRemaining) },
      });
      transaction.update(invoice.ref, {
        status: decided.status,
        balanceCents: decided.balanceCents,
        ...(decided.keptReason
          ? { providerReportKept: { reason: decided.keptReason, at: now } }
          : {}),
        // A declined charge is recorded beside the status, not as `sent`
        // with nothing said: Today raises it (./payment-failure.ts).
        ...stripePaymentFailureFields({
          eventType: event.type,
          eventId: event.id,
          decidedStatus: String(decided.status),
          object,
          now,
        }),
        lastProviderEventId: event.id,
        lastSyncedAt: now,
        updatedAt: now,
        updatedBy: "stripe-connect-webhook",
      });
    });
    response.status(200).json({ received: true });
  },
);
