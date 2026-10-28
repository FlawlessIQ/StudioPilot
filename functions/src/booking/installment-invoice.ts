import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { retainerFromSchedule } from "./agreed-retainer.js";
import { isStandingInvoice } from "./invoice-standing.js";
import { combinedSnapshot, jobPackagesName, readJobSnapshots } from "../packages/combined-snapshot.js";
import type { JobBilling } from "../billing/job-billing.js";
import { writeStudioInvoiceDraft } from "../billing/studio-invoice-issue.js";
import { invoiceRecordsDeleted } from "../billing/invoice-purge-policy.js";
import { installmentName, installmentsBilledCents, nextInstallmentToBill } from "../billing/payment-plan.js";

/**
 * Raising one installment of a payment plan (billing/payment-plan.ts).
 *
 * The final balance's twin (./final-invoice.ts), and deliberately the same
 * shape: whoever billed the deposit bills the installment, a job the studio
 * bills itself gets a numbered draft of its own to send, and the daily run
 * never resolves an invoicing customer — nothing new is billed without
 * someone choosing to, so a deposit recorded by hand leaves the installment
 * on Today for the studio to send (`resolveCustomer`, sendInstallment).
 *
 * Which installment, and when, is the plan's decision (nextInstallmentToBill):
 * the earliest one with no standing bill, two weeks before its date, and
 * none once a final balance stands. The amount is the agreed line, never more
 * than what is left of the agreed total after the deposit and the
 * installments already billed. Never taxed: like the deposit, an installment
 * is a part of the agreed price, and the tax goes on the bill that completes
 * it (the final balance).
 */

const day = (iso: string) => iso.slice(0, 10);

const paidOf = (invoice: DocumentSnapshot) => {
  const amount = Number(invoice.get("amountCents") ?? 0);
  const balance = Number(invoice.get("balanceCents") ?? amount);
  return Math.max(0, amount - balance);
};

export type InstallmentInvoiceOutcome =
  | { raised: true; invoiceId: string; amountCents: number; sequence: number; count: number }
  | { raised: false; reason: string };

/** The installment's bill id: stable for the first, numbered for one raised again after a change or a failure. */
export function installmentInvoiceId(projectId: string, sequence: number, earlierAttempts: number): string {
  return `installment_${projectId}_${sequence}${earlierAttempts ? `_r${earlierAttempts}` : ""}`;
}

export async function raiseInstallmentInvoice(
  db: Firestore,
  transaction: Transaction,
  project: DocumentSnapshot,
  options: {
    actor: string;
    now: string;
    /** How the job is billed (billing/job-billing-reader.ts jobBillingFor), read before the transaction. */
    billing: JobBilling;
    /** The studio's invoicing provider, for a deposit that names none. */
    provider?: "quickbooks" | "stripe";
    /** A person asked for this bill (sendInstallment): find or create the couple at the provider. */
    resolveCustomer?: boolean;
    /** A person asked for it now, ahead of its day. */
    ignoreDate?: boolean;
    /** The calendar day the daily run is deciding for (UTC); the day of `now` when left out. */
    today?: string;
  },
): Promise<InstallmentInvoiceOutcome> {
  const studioBilled = options.billing.method === "studio";
  if (invoiceRecordsDeleted(project.data())) return { raised: false, reason: "records_deleted" };
  const tenantId = String(project.get("tenantId") ?? "");
  const today = options.today ?? day(options.now);
  const [invoiceDocs, acceptedDocs] = await Promise.all([
    transaction.get(
      db.collection("invoiceReferences").where("tenantId", "==", tenantId).where("projectId", "==", project.id).limit(60),
    ),
    transaction.get(
      db
        .collection("proposals")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", project.id)
        .where("status", "==", "accepted")
        .limit(5),
    ),
  ]);
  const invoices = invoiceDocs.docs;
  const accepted = acceptedDocs.docs.sort((a, b) => Number(b.get("version") ?? 0) - Number(a.get("version") ?? 0))[0];
  if (!accepted) return { raised: false, reason: "no_plan" };
  const schedule = accepted.get("paymentSchedule");
  const plain = invoices.map((invoice) => ({ ...(invoice.data() as Record<string, unknown>) }));
  const due = nextInstallmentToBill({ schedule, invoices: plain, today, ignoreDate: options.ignoreDate });
  if (!due) return { raised: false, reason: "not_due" };

  const standing = invoices.filter((invoice) => isStandingInvoice(invoice.get("status")));
  const retainer = standing.find((invoice) => invoice.get("kind") === "retainer") ?? null;
  const waiver = retainer
    ? null
    : (
        await transaction.get(
          db
            .collection("bookingExceptions")
            .where("tenantId", "==", tenantId)
            .where("projectId", "==", project.id)
            .where("type", "==", "retainer")
            .limit(5),
        )
      ).docs.find((exception) => exception.get("status") === "approved") ?? null;
  // An installment follows a booking: the deposit billed (or waived) first.
  if (!retainer && !waiver) return { raised: false, reason: "no_retainer" };

  // Billed by whoever billed the deposit, as the final balance is.
  const retainerProvider = String(retainer?.get("provider") ?? "");
  const provider: "quickbooks" | "stripe" =
    retainerProvider === "stripe" || retainerProvider === "quickbooks" ? retainerProvider : (options.provider ?? "quickbooks");
  const retainerCustomer = retainer?.get("providerCustomerId");
  let customerId = "";
  if (studioBilled) customerId = "";
  else if (typeof retainerCustomer === "string" && retainerCustomer && retainerProvider === provider) customerId = retainerCustomer;
  else if (options.resolveCustomer) customerId = `pending_${project.id}`;
  else return { raised: false, reason: "no_provider_customer" };

  // Never more than is left of the agreed total: the deposit (as paid, or as
  // agreed when nothing is paid yet) and every installment billed come off it.
  const pricing = (accepted.get("pricingSnapshot") ?? {}) as Record<string, unknown>;
  const jobSnapshots = await readJobSnapshots(db, project.data(), tenantId, (reference) => transaction.get(reference));
  const packageSnapshot = jobSnapshots.length ? combinedSnapshot(jobSnapshots) : null;
  const agreedTotal = Number(pricing.totalCents);
  const totalCents = Number.isSafeInteger(agreedTotal) && agreedTotal > 0 ? agreedTotal : Number(packageSnapshot?.get("totalCents") ?? 0);
  const retainerCents = retainer
    ? Math.max(paidOf(retainer), retainerFromSchedule(schedule, Number(packageSnapshot?.get("retainerCents") ?? 0)))
    : 0;
  const room = totalCents - retainerCents - installmentsBilledCents(plain);
  const amountCents = Math.min(due.amountCents, room);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { raised: false, reason: "nothing_owed" };

  const earlier = invoices.filter(
    (invoice) => invoice.get("kind") === "installment" && Number(invoice.get("installmentSequence")) === due.sequence,
  ).length;
  const invoiceId = installmentInvoiceId(project.id, due.sequence, earlier);
  const invoiceReference = db.doc(`invoiceReferences/${invoiceId}`);
  if ((await transaction.get(invoiceReference)).exists) return { raised: false, reason: "exists" };

  const name = installmentName(due.sequence, due.count);
  // Due on its agreed date; one whose date has passed (a booking signed late)
  // is due on receipt, never overdue on the day it is sent.
  const dueDate = due.dueDate > today ? due.dueDate : today;
  const currency = String(pricing.currency ?? packageSnapshot?.get("currency") ?? "USD");
  const calculation = {
    lines: [
      { label: name, amountCents, source: `proposals/${accepted.id}` },
    ],
    scheduledCents: due.amountCents,
    agreedTotalCents: totalCents,
    retainerCents,
    installmentsBilledCents: installmentsBilledCents(plain),
    authority: studioBilled ? "studio" : provider,
    calculatedAt: options.now,
  };
  const planFields = { installmentSequence: due.sequence, installmentCount: due.count };

  if (studioBilled) {
    const packageName = jobPackagesName(jobSnapshots);
    const written = await writeStudioInvoiceDraft(db, transaction, {
      tenantId,
      projectId: project.id,
      invoiceId,
      draft: {
        kind: "installment",
        paidInFull: false,
        subtotalCents: amountCents,
        completesPrice: false,
        taxCents: 0,
        lines: [{ description: `${name} · ${packageName}`, quantity: 1, unitAmountCents: amountCents, amountCents }],
        currency,
        dueDate,
        extra: { ...planFields, calculation },
      },
      actor: options.actor,
      now: options.now,
    });
    if (!written.created) return { raised: false, reason: "exists" };
    return { raised: true, invoiceId, amountCents, sequence: due.sequence, count: due.count };
  }
  transaction.create(invoiceReference, {
    id: invoiceId,
    tenantId,
    projectId: project.id,
    kind: "installment",
    ...planFields,
    provider,
    providerInvoiceId: `pending_${invoiceId}`,
    providerCustomerId: customerId,
    status: "draft",
    currency,
    amountCents,
    balanceCents: amountCents,
    dueDate,
    hostedUrl: null,
    lastSyncedAt: options.now,
    lastProviderEventId: null,
    providerState: "queued",
    calculation,
    createdAt: options.now,
    updatedAt: options.now,
    createdBy: options.actor,
    updatedBy: options.actor,
    archivedAt: null,
  });
  transaction.create(db.doc(`providerJobs/invoice_${invoiceId}`), {
    id: `invoice_${invoiceId}`,
    tenantId,
    projectId: project.id,
    type: provider === "stripe" ? "create_stripe_invoice" : "create_quickbooks_invoice",
    invoiceId,
    idempotencyKey: `installment-invoice-${invoiceId}`,
    status: "queued",
    attempts: 0,
    createdAt: options.now,
    updatedAt: options.now,
  });
  return { raised: true, invoiceId, amountCents, sequence: due.sequence, count: due.count };
}
