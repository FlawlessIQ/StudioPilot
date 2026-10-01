import { createHash } from "node:crypto";
import { getFirestore, type DocumentSnapshot, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { connection, providerJson } from "../operations/provider-runtime.js";
import { quickBooksApiBaseUrl } from "../integrations/provider-config.js";
import { quickBooksCompany } from "../integrations/quickbooks-items.js";
import {
  invoiceIdsLinkedTo,
  quickBooksEntityGone,
  refundRecordedTask,
  refundSummary,
} from "./quickbooks-money-events-core.js";

/**
 * A QuickBooks Payment, CreditMemo or RefundReceipt event, worked through
 * (job type reconcile_quickbooks_money_event, queued by quickbooksWebhook).
 * See quickbooks-money-events-core.ts for why.
 *
 * It never writes an invoice itself: it queues the ordinary invoice
 * reconcile for each StudioCue invoice the money touched, so the balance
 * still comes from one place (provider-runtime reconcileQuickBooksInvoice,
 * which also raises the "no longer paid" task). Runs only in the job
 * workers, which hold the QuickBooks client credentials.
 */

const ENTITY_PATH: Record<string, string> = {
  payment: "payment",
  creditmemo: "creditmemo",
  refundreceipt: "refundreceipt",
};

const ENTITY_KEY: Record<string, string> = {
  payment: "Payment",
  creditmemo: "CreditMemo",
  refundreceipt: "RefundReceipt",
};

const isQuickBooks = (invoice: QueryDocumentSnapshot) =>
  invoice.get("provider") === "quickbooks" &&
  typeof invoice.get("providerInvoiceId") === "string" &&
  !String(invoice.get("providerInvoiceId")).startsWith("pending_");

export async function reconcileQuickBooksMoneyEvent(job: DocumentSnapshot) {
  const db = getFirestore();
  const tenantId = String(job.get("tenantId") ?? "");
  const entityName = String(job.get("entityName") ?? "").toLowerCase();
  const entityId = String(job.get("entityId") ?? "");
  const operation = String(job.get("operation") ?? "").toLowerCase();
  const eventKey = String(job.get("idempotencyKey") ?? job.id);
  const webhookEventId = String(job.get("webhookEventId") ?? "");
  if (!tenantId || !ENTITY_PATH[entityName] || !entityId) throw new Error("QUICKBOOKS_MONEY_EVENT_INVALID");

  const invoices = db.collection("invoiceReferences");
  const touched: QueryDocumentSnapshot[] = [];
  let refundTask: ReturnType<typeof refundRecordedTask> | null = null;

  const link = await connection(tenantId, "quickbooks");
  if (!link.mock) {
    const credential = link.credential;
    const realmId = credential?.realmId ?? String(job.get("realmId") ?? link.document.get("providerAccountId") ?? "");
    if (!credential || !realmId) throw new Error("QUICKBOOKS_REALM_MISSING");
    const company = quickBooksCompany({
      apiBaseUrl: quickBooksApiBaseUrl(credential.baseUrl),
      realmId,
      accessToken: credential.accessToken,
      request: providerJson,
    });
    const gone = quickBooksEntityGone(operation);
    const entity = gone
      ? null
      : ((await company.get(`${ENTITY_PATH[entityName]}/${encodeURIComponent(entityId)}`, "QUICKBOOKS_MONEY_EVENT_READ_FAILED"))[
          ENTITY_KEY[entityName]!
        ] as Record<string, unknown> | undefined) ?? null;

    if (entityName === "refundreceipt") {
      // Refunds leave the invoice paid in QuickBooks; tell the studio instead.
      const summary = entity ? refundSummary(entity) : null;
      if (summary?.customerId && summary.amountCents > 0) {
        const theirs = (
          await invoices.where("tenantId", "==", tenantId).where("providerCustomerId", "==", summary.customerId).limit(50).get()
        ).docs.filter(isQuickBooks);
        const latest = theirs.sort((a, b) => String(b.get("createdAt") ?? "").localeCompare(String(a.get("createdAt") ?? "")))[0];
        const projectId = String(latest?.get("projectId") ?? "");
        if (projectId)
          refundTask = refundRecordedTask({
            refundId: entityId,
            tenantId,
            projectId,
            amountCents: summary.amountCents,
            currency: summary.currency,
            docNumber: summary.docNumber,
            customerName: summary.customerName,
            now: new Date().toISOString(),
          });
      }
    } else if (entity) {
      // A payment or credit memo we can read: the invoices it is applied to,
      // and for a credit memo every invoice of that customer (a credit can be
      // applied later, by a payment that names only the memo).
      const ids = invoiceIdsLinkedTo(entity);
      for (const id of ids.slice(0, 20)) {
        const found = await invoices.where("tenantId", "==", tenantId).where("providerInvoiceId", "==", id).limit(1).get();
        touched.push(...found.docs);
      }
      const customerId = String((entity.CustomerRef as { value?: unknown } | undefined)?.value ?? "");
      if (entityName === "creditmemo" && customerId) {
        touched.push(
          ...(await invoices.where("tenantId", "==", tenantId).where("providerCustomerId", "==", customerId).limit(50).get()).docs,
        );
      }
    } else {
      // Deleted: QuickBooks cannot say what it was applied to any more. Re-read
      // every invoice StudioCue counts as (part) paid; the reconcile leaves any
      // that QuickBooks still shows paid exactly as they are.
      for (const status of ["paid", "partially_paid"]) {
        touched.push(...(await invoices.where("tenantId", "==", tenantId).where("status", "==", status).limit(100).get()).docs);
      }
    }
  }

  const unique = [...new Map(touched.filter(isQuickBooks).map((invoice) => [invoice.id, invoice])).values()];
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const invoice of unique) {
    const key = `${eventKey}:${invoice.id}`;
    const id = `quickbooks_reconcile_${createHash("sha256").update(key).digest("hex")}`;
    batch.set(
      db.doc(`providerJobs/${id}`),
      {
        id,
        tenantId,
        projectId: String(invoice.get("projectId") ?? "") || null,
        invoiceId: invoice.id,
        providerInvoiceId: String(invoice.get("providerInvoiceId")),
        realmId: String(job.get("realmId") ?? ""),
        // Not the money event's operation: a deleted payment must not void the invoice.
        operation: "update",
        occurredAt: String(job.get("occurredAt") ?? now),
        webhookEventId: "",
        type: "reconcile_quickbooks_invoice",
        idempotencyKey: key,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }
  if (refundTask) batch.set(db.doc(`tasks/${refundTask.id}`), refundTask, { merge: true });
  if (webhookEventId) batch.update(db.doc(`webhookEvents/${webhookEventId}`), { status: "processed", processedAt: now });
  await batch.commit();
  return {
    entityName,
    entityId,
    operation,
    mock: link.mock,
    reconcileQueued: unique.map((invoice) => invoice.id),
    refundTaskId: refundTask?.id ?? null,
  };
}
