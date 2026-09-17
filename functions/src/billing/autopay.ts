import { clientAutomationsPaused } from "../imports/existing-booking.js";
import { createHash } from "node:crypto";
import { FieldValue, getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { quickBooksApiBaseUrl } from "../integrations/provider-config.js";
import {
  connection,
  quickBooksCustomerId,
  type Credential,
} from "../operations/provider-runtime.js";
import { productEvent } from "../operations/product-events.js";
import {
  autopayChargeDue,
  hasPaymentsScope,
  lastFour,
  paymentsAmount,
  paymentsFailureCode,
  quickBooksPaymentsBaseUrl,
  type AutopayAttempt,
} from "./autopay-core.js";

/**
 * Autopay's side effects: save a card, remove a card, charge a card, and the
 * daily scheduler that decides when. The rules live in ./autopay-core.ts.
 */

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const stable = (...parts: string[]) =>
  createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32);
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");

class PaymentsError extends Error {
  constructor(public code: string, public status: number, detail: string) {
    super(`${code}:${status}:${detail.slice(0, 200)}`);
  }
}

async function paymentsCall(
  credential: Credential,
  path: string,
  init: { method: string; requestId?: string; body?: unknown },
): Promise<Json> {
  const base = quickBooksPaymentsBaseUrl(credential.baseUrl, process.env.QUICKBOOKS_PAYMENTS_BASE_URL);
  const response = await fetch(`${base}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${credential.accessToken}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.requestId ? { "request-id": init.requestId.slice(0, 50) } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const raw = await response.text();
  if (!response.ok) throw new PaymentsError(paymentsFailureCode(response.status, raw), response.status, raw);
  try {
    return asRecord(JSON.parse(raw || "{}"));
  } catch {
    return {};
  }
}

/** The QuickBooks connection, refusing clearly when payments were never granted. */
async function paymentsConnection(tenantId: string) {
  const provider = await connection(tenantId, "quickbooks");
  if (!provider.mock && !hasPaymentsScope(provider.document.get("scopes")))
    throw new PaymentsError("QUICKBOOKS_PAYMENTS_NOT_GRANTED", 403, "reconnect with payments");
  return provider;
}

async function retainerFor(tenantId: string, projectId: string) {
  const found = await getFirestore()
    .collection("invoiceReferences")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .where("kind", "==", "retainer")
    .limit(1)
    .get();
  return found.docs[0] ?? null;
}

function studioNotification(input: {
  tenantId: string;
  projectId: string;
  id: string;
  title: string;
  body: string;
  now: string;
}) {
  return getFirestore().doc(`notifications/${input.id}`).set(
    {
      id: input.id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      userId: null,
      audience: "studio",
      type: "autopay",
      title: input.title,
      body: input.body,
      href: `/studio/invoices?project=${encodeURIComponent(input.projectId)}`,
      readAt: null,
      createdAt: input.now,
    },
    { merge: true },
  );
}

/** Provider job `save_quickbooks_card`: store the tokenised card in the couple's Intuit wallet. */
export async function saveQuickBooksCard(job: DocumentSnapshot) {
  const db = getFirestore();
  const tenantId = text(job.get("tenantId"));
  const projectId = text(job.get("projectId"));
  const methodReference = db.doc(`paymentMethods/${text(job.get("paymentMethodId"))}`);
  const token = text(job.get("cardToken"));
  const now = new Date().toISOString();
  // The token is single-use and short-lived; it never outlives this attempt.
  await job.ref.update({ cardToken: FieldValue.delete(), updatedAt: now });
  try {
    if (!token) throw new PaymentsError("CARD_TOKEN_EXPIRED", 400, "token missing");
    const provider = await paymentsConnection(tenantId);
    let card: Json;
    let customerId: string;
    if (provider.mock) {
      customerId = `mock_customer_${projectId}`;
      card = { id: `mock_card_${stable(token)}`, number: "xxxxxxxxxxxx4242", expMonth: "12", expYear: "2030", cardType: "Visa" };
    } else {
      const credential = provider.credential!;
      const realmId = credential.realmId ?? text(provider.document.get("providerAccountId"));
      const retainer = await retainerFor(tenantId, projectId);
      if (!retainer) throw new PaymentsError("AUTOPAY_NO_DEPOSIT_INVOICE", 400, "no retainer");
      customerId = await quickBooksCustomerId(tenantId, projectId, retainer, credential, realmId, job.id);
      card = await paymentsCall(credential, `/quickbooks/v4/customers/${encodeURIComponent(customerId)}/cards/createFromToken`, {
        method: "POST",
        requestId: `${job.id}-card`,
        body: { value: token },
      });
    }
    await methodReference.update({
      status: "active",
      providerCustomerId: customerId,
      providerCardId: text(card.id),
      brand: text(card.cardType) || null,
      last4: lastFour(card.number),
      expMonth: text(card.expMonth) || String(card.expMonth ?? ""),
      expYear: text(card.expYear) || String(card.expYear ?? ""),
      failureCode: null,
      activatedAt: now,
      updatedAt: now,
      updatedBy: "autopay-worker",
    });
    return { paymentMethodId: methodReference.id, status: "active" };
  } catch (caught: unknown) {
    const code = caught instanceof PaymentsError ? caught.code : "AUTOPAY_CARD_SAVE_FAILED";
    await methodReference.update({ status: "failed", failureCode: code, updatedAt: now, updatedBy: "autopay-worker" });
    if (code === "QUICKBOOKS_PAYMENTS_NOT_ACTIVE" || code === "QUICKBOOKS_PAYMENTS_NOT_GRANTED") {
      await studioNotification({
        tenantId,
        projectId,
        id: `autopay_setup_${tenantId}`,
        title: "A couple couldn't save a card for autopay",
        body: "QuickBooks refused it: QuickBooks Payments isn't active on your company yet, or StudioCue hasn't been given permission to use it. Check Integrations → Autopay.",
        now,
      });
    }
    // Recorded on the method; the job itself should not retry a refused card.
    return { paymentMethodId: methodReference.id, status: "failed", code };
  }
}

/** Provider job `remove_quickbooks_card`. The method is already marked removed. */
export async function removeQuickBooksCard(job: DocumentSnapshot) {
  const method = await getFirestore().doc(`paymentMethods/${text(job.get("paymentMethodId"))}`).get();
  const cardId = text(method.get("providerCardId"));
  const customerId = text(method.get("providerCustomerId"));
  if (!method.exists || !cardId || !customerId) return { removed: false };
  const provider = await connection(text(job.get("tenantId")), "quickbooks");
  if (!provider.mock) {
    await paymentsCall(provider.credential!, `/quickbooks/v4/customers/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
    }).catch((caught: unknown) => {
      // Already gone at Intuit is the outcome we wanted.
      if (!(caught instanceof PaymentsError && caught.status === 404)) throw caught;
    });
  }
  await method.ref.update({ providerCardId: null, updatedAt: new Date().toISOString(), updatedBy: "autopay-worker" });
  return { removed: true };
}

/**
 * Provider job `charge_saved_card`: charge the final balance, then record the
 * payment against the QuickBooks invoice so the existing reconcile marks it paid.
 */
export async function chargeSavedCard(job: DocumentSnapshot) {
  const db = getFirestore();
  const tenantId = text(job.get("tenantId"));
  const projectId = text(job.get("projectId"));
  const chargeReference = db.doc(`autopayCharges/${job.id}`);
  const [invoice, method, existing] = await Promise.all([
    db.doc(`invoiceReferences/${text(job.get("invoiceId"))}`).get(),
    db.doc(`paymentMethods/${text(job.get("paymentMethodId"))}`).get(),
    chargeReference.get(),
  ]);
  if (!invoice.exists || invoice.get("tenantId") !== tenantId) throw new Error("INVOICE_NOT_FOUND");
  const now = new Date().toISOString();
  const amountCents = Number(existing.get("amountCents") ?? invoice.get("balanceCents") ?? 0);
  const record = (fields: Json) =>
    chargeReference.set({ id: job.id, tenantId, projectId, invoiceId: invoice.id, paymentMethodId: method.id, attempt: Number(job.get("attempt") ?? 1), amountCents, currency: text(invoice.get("currency")) || "USD", updatedAt: now, ...fields }, { merge: true });

  if (!method.exists || method.get("status") !== "active" || !text(method.get("providerCardId"))) {
    await record({ status: "skipped", failureCode: "CARD_NOT_ACTIVE", createdAt: existing.get("createdAt") ?? now });
    return { status: "skipped" };
  }
  if (!(amountCents > 0)) return { status: "skipped" };

  const provider = await paymentsConnection(tenantId);
  let chargeId = text(existing.get("providerChargeId"));
  try {
    if (!chargeId) {
      await record({ status: "pending", createdAt: existing.get("createdAt") ?? now });
      if (provider.mock) {
        chargeId = `mock_charge_${job.id}`;
      } else {
        const charge = await paymentsCall(provider.credential!, "/quickbooks/v4/payments/charges", {
          method: "POST",
          requestId: text(job.get("idempotencyKey")) || job.id,
          body: {
            amount: paymentsAmount(amountCents),
            currency: text(invoice.get("currency")) || "USD",
            cardOnFile: text(method.get("providerCardId")),
            context: { mobile: false, isEcommerce: true },
            description: `Final balance ${text(invoice.get("docNumber")) || invoice.id}`.slice(0, 64),
          },
        });
        if (!["CAPTURED", "SETTLED"].includes(text(charge.status).toUpperCase()))
          throw new PaymentsError("CARD_DECLINED", 402, text(charge.status));
        chargeId = text(charge.id);
      }
      await record({ status: "charged", providerChargeId: chargeId, chargedAt: now });
    }
    // Record the payment in the books. Separate from the charge so a failure
    // here retries only this, never the charge.
    let paymentId = text(existing.get("providerPaymentId"));
    if (!paymentId && !provider.mock) {
      const credential = provider.credential!;
      const realmId = credential.realmId ?? text(provider.document.get("providerAccountId"));
      const response = await fetch(
        `${quickBooksApiBaseUrl(credential.baseUrl)}/v3/company/${encodeURIComponent(realmId)}/payment?minorversion=75`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${credential.accessToken}`, accept: "application/json", "content-type": "application/json", "request-id": `${job.id}-payment`.slice(0, 50) },
          body: JSON.stringify({
            CustomerRef: { value: text(method.get("providerCustomerId")) || text(invoice.get("providerCustomerId")) },
            TotalAmt: amountCents / 100,
            PaymentRefNum: chargeId.slice(0, 21),
            PrivateNote: `StudioCue autopay ${job.id}`,
            Line: [{ Amount: amountCents / 100, LinkedTxn: [{ TxnId: text(invoice.get("providerInvoiceId")), TxnType: "Invoice" }] }],
          }),
        },
      );
      const body = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) throw new Error(`QUICKBOOKS_PAYMENT_RECORD_FAILED:${response.status}`);
      paymentId = text(asRecord(body.Payment).Id);
    }
    await record({ status: "succeeded", providerPaymentId: paymentId || null, succeededAt: now });
    const batch = db.batch();
    batch.set(db.doc(`providerJobs/reconcile_autopay_${job.id}`), {
      id: `reconcile_autopay_${job.id}`,
      tenantId,
      projectId,
      type: "reconcile_quickbooks_invoice",
      invoiceId: invoice.id,
      providerInvoiceId: text(invoice.get("providerInvoiceId")),
      idempotencyKey: `reconcile-autopay-${job.id}`,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    batch.set(db.doc(`emailJobs/autopay_receipt_${job.id}`), {
      id: `autopay_receipt_${job.id}`,
      tenantId,
      projectId,
      type: "autopay_charged",
      amountText: `${paymentsAmount(amountCents)} ${text(invoice.get("currency")) || "USD"}`,
      cardText: `${text(method.get("brand")) || "Card"} ending ${text(method.get("last4"))}`,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    const event = productEvent({
      tenantId,
      projectId,
      actorId: "autopay-worker",
      actorType: "provider",
      name: "billing.autopay_charged",
      occurredAt: now,
      correlationId: job.id,
      sourceEntityType: "autopayCharge",
      sourceEntityId: job.id,
      properties: { amountCents, attempt: Number(job.get("attempt") ?? 1) },
    });
    batch.set(db.doc(`productEvents/${event.id}`), event);
    await batch.commit();
    return { status: "succeeded", chargeId };
  } catch (caught: unknown) {
    // Recording the payment failed after a successful charge: retry the job
    // (it will skip the charge), and never tell the couple they were declined.
    if (chargeId) throw caught;
    const code = caught instanceof PaymentsError ? caught.code : "AUTOPAY_CHARGE_FAILED";
    if (!(caught instanceof PaymentsError) || caught.status >= 500) {
      await record({ status: "pending" });
      throw caught;
    }
    await record({ status: "failed", failureCode: code, failedAt: now });
    const attempt = Number(job.get("attempt") ?? 1);
    const batch = db.batch();
    // The couple still has the invoice link — a declined card must never
    // leave them without a way to pay.
    if (code !== "QUICKBOOKS_PAYMENTS_NOT_ACTIVE" && code !== "QUICKBOOKS_PAYMENTS_NOT_GRANTED") {
      batch.set(db.doc(`emailJobs/autopay_declined_${job.id}`), {
        id: `autopay_declined_${job.id}`,
        tenantId,
        projectId,
        type: "autopay_charge_failed",
        invoiceUrl: text(invoice.get("hostedUrl")) || `${appUrl()}/client/payments`,
        willRetry: attempt < 2,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
    }
    await batch.commit();
    await studioNotification({
      tenantId,
      projectId,
      id: `autopay_failed_${job.id}`,
      title: code === "QUICKBOOKS_PAYMENTS_NOT_ACTIVE" ? "Autopay couldn't charge: QuickBooks Payments isn't active" : "An autopay charge was declined",
      body:
        code === "QUICKBOOKS_PAYMENTS_NOT_ACTIVE"
          ? "QuickBooks refused the charge because Payments isn't active on your company. Finish your QuickBooks Payments application, then reconnect QuickBooks under Integrations → Autopay."
          : attempt < 2
            ? "The couple was sent their invoice link and StudioCue will try the card once more in 3 days."
            : "The retry was declined too. The couple has their invoice link; follow up with them directly.",
      now,
    });
    return { status: "failed", code };
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** Daily: charge saved cards whose final balance is due. */
export const autopayScheduler = onSchedule(
  { schedule: "every day 15:00", timeZone: "UTC", retryCount: 1 },
  async () => {
    const db = getFirestore();
    const methods = await db.collection("paymentMethods").where("status", "==", "active").limit(500).get();
    for (const method of methods.docs) {
      const tenantId = text(method.get("tenantId"));
      const projectId = text(method.get("projectId"));
      const tenant = await db.doc(`tenants/${tenantId}`).get();
      if (asRecord(tenant.get("autopay")).enabled !== true) continue;
      // Never charge a card on a booking the studio hasn't brought in yet.
      const project = await db.doc(`projects/${projectId}`).get();
      if (clientAutomationsPaused(project.data())) continue;
      const invoices = await db
        .collection("invoiceReferences")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", projectId)
        .where("kind", "==", "final")
        .limit(5)
        .get();
      for (const invoice of invoices.docs) {
        const charges = await db
          .collection("autopayCharges")
          .where("tenantId", "==", tenantId)
          .where("invoiceId", "==", invoice.id)
          .limit(10)
          .get();
        const attempts: AutopayAttempt[] = charges.docs
          .filter((charge) => charge.get("status") !== "skipped")
          .map((charge) => ({
            attempt: Number(charge.get("attempt") ?? 1),
            status: charge.get("status") === "failed" ? "failed" : charge.get("status") === "succeeded" ? "succeeded" : "pending",
            createdAt: text(charge.get("failedAt")) || text(charge.get("createdAt")),
          }));
        const decision = autopayChargeDue({ invoice: invoice.data() as Parameters<typeof autopayChargeDue>[0]["invoice"], attempts, today: today() });
        if (!decision.due) continue;
        const jobId = `autopay_${invoice.id}_${decision.attempt}`;
        const now = new Date().toISOString();
        await db
          .doc(`providerJobs/${jobId}`)
          .create({
            id: jobId,
            tenantId,
            projectId,
            type: "charge_saved_card",
            invoiceId: invoice.id,
            paymentMethodId: method.id,
            attempt: decision.attempt,
            idempotencyKey: `autopay-${invoice.id}-${decision.attempt}`,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          })
          .catch(() => undefined);
      }
    }
  },
);
