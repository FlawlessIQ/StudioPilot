import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { retainerFromSchedule } from "./agreed-retainer.js";
import { isStandingInvoice } from "./invoice-standing.js";

/**
 * Raising the final-balance invoice.
 *
 * Lifted out of the daily scheduler so a booking change can raise the
 * replacement for a final invoice it superseded (booking amendments,
 * functions/src/contracts/amendments.ts) instead of waiting for a scheduler
 * that only fires on the day that is exactly 28 days out — a date moved
 * inside that window would otherwise never be billed.
 *
 * The balance is the accepted proposal's total less everything already
 * paid: the retainer and, after a change to a job that had paid in full, the
 * earlier final invoice too. For an unchanged job that is the retainer alone,
 * which is what this has always charged.
 */

const date = (value: Date) => value.toISOString().slice(0, 10);

const paidOf = (invoice: DocumentSnapshot) => {
  const amount = Number(invoice.get("amountCents") ?? 0);
  const balance = Number(invoice.get("balanceCents") ?? amount);
  return Math.max(0, amount - balance);
};

export type FinalInvoiceOutcome =
  | { raised: true; invoiceId: string; amountCents: number; reviewRequired: boolean }
  | { raised: false; reason: string };

export async function raiseFinalInvoice(
  db: Firestore,
  transaction: Transaction,
  project: DocumentSnapshot,
  options: {
    invoiceId: string;
    actor: string;
    now: string;
    /** The studio's invoicing provider, for a retainer that names none. */
    provider?: "quickbooks" | "stripe";
    /**
     * A person asked for this bill (sendFinalBalance), so a retainer with no
     * provider customer — recorded by hand, or paid another way — is no reason
     * to stop: the provider worker finds or creates the couple from their
     * contact email, as it does for a retainer. The daily scheduler never sets
     * this, so nothing new is billed without somebody choosing to.
     */
    resolveCustomer?: boolean;
  },
): Promise<FinalInvoiceOutcome> {
  const tenantId = String(project.get("tenantId") ?? "");
  const invoiceReference = db.doc(`invoiceReferences/${options.invoiceId}`);
  if ((await transaction.get(invoiceReference)).exists) return { raised: false, reason: "exists" };
  const snapshotId = String(project.get("packageSnapshotId") ?? "");
  if (!snapshotId) return { raised: false, reason: "no_package" };
  const packageSnapshot = await transaction.get(db.doc(`packageSnapshots/${snapshotId}`));
  if (!packageSnapshot.exists) return { raised: false, reason: "no_package" };
  const invoices = (
    await transaction.get(
      db
        .collection("invoiceReferences")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", project.id)
        .limit(40),
    )
  ).docs;
  const standing = invoices.filter((invoice) => isStandingInvoice(invoice.get("status")));
  // Another final is still owed: one bill for one balance.
  if (standing.some((invoice) => invoice.get("kind") === "final" && Number(invoice.get("balanceCents") ?? 0) > 0))
    return { raised: false, reason: "final_outstanding" };
  const retainer = standing.find((invoice) => invoice.get("kind") === "retainer");
  if (!retainer) return { raised: false, reason: "no_retainer" };
  // Billed by whoever billed the retainer; a retainer recorded by hand names
  // no provider, and then the studio's invoicing provider decides. Before
  // this, every final went to QuickBooks — a Stripe studio's final carried a
  // Stripe customer id into QuickBooks and failed there.
  const retainerProvider = String(retainer.get("provider") ?? "");
  const provider: "quickbooks" | "stripe" =
    retainerProvider === "stripe" || retainerProvider === "quickbooks"
      ? retainerProvider
      : (options.provider ?? "quickbooks");
  const retainerCustomer = retainer.get("providerCustomerId");
  let customerId: string;
  if (typeof retainerCustomer === "string" && retainerCustomer && retainerProvider === provider) customerId = retainerCustomer;
  else if (options.resolveCustomer) customerId = `pending_${project.id}`;
  else return { raised: false, reason: "no_provider_customer" };

  // What the couple agreed to is the accepted proposal: every package on the
  // job, and the retainer as scheduled (H2, M2/M3).
  const accepted = (
    await transaction.get(
      db
        .collection("proposals")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", project.id)
        .where("status", "==", "accepted")
        .limit(5),
    )
  ).docs.sort((a, b) => Number(b.get("version") ?? 0) - Number(a.get("version") ?? 0))[0];
  const agreedPricing = (accepted?.get("pricingSnapshot") ?? null) as Record<string, unknown> | null;
  const agreedTotal = Number(agreedPricing?.totalCents);
  const fromProposal = Boolean(accepted && Number.isSafeInteger(agreedTotal) && agreedTotal > 0);
  const source = fromProposal ? `proposals/${accepted!.id}` : `packageSnapshots/${snapshotId}`;
  const totalCents = fromProposal ? agreedTotal : Number(packageSnapshot.get("totalCents") ?? 0);
  const taxCents = fromProposal
    ? Number(agreedPricing?.taxCents ?? 0)
    : Number(packageSnapshot.get("taxCents") ?? 0);
  const retainerExpectedCents = retainerFromSchedule(
    accepted?.get("paymentSchedule"),
    Number(packageSnapshot.get("retainerCents") ?? 0),
  );
  const retainerPaidCents = paidOf(retainer);
  const earlierFinalsPaidCents = standing
    .filter((invoice) => invoice.get("kind") === "final")
    .reduce((sum, invoice) => sum + paidOf(invoice), 0);
  const amountCents = totalCents - retainerPaidCents - earlierFinalsPaidCents;
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(amountCents) || amountCents <= 0)
    return { raised: false, reason: "nothing_owed" };

  const discrepancies: string[] = [];
  if (retainerPaidCents !== retainerExpectedCents) discrepancies.push("RETAINER_EVIDENCE_MISMATCH");
  const readyForProviderDraft = discrepancies.length === 0;
  const due = new Date(`${String(project.get("eventDate"))}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() - 14);
  const calculation = {
    lines: [
      { label: "Approved package and add-ons", amountCents: totalCents - taxCents, source },
      { label: "Approved tax", amountCents: taxCents, source },
      {
        label: "Retainer payment received",
        amountCents: -retainerPaidCents,
        source: `invoiceReferences/${retainer.id}`,
      },
      ...(earlierFinalsPaidCents
        ? [{ label: "Earlier balance payments received", amountCents: -earlierFinalsPaidCents, source: "invoiceReferences" }]
        : []),
    ],
    packageTotalCents: totalCents,
    retainerExpectedCents,
    retainerPaidCents,
    expectedBalanceCents: amountCents,
    discrepancies,
    authority: provider,
    requiresHumanReview: true,
    calculatedAt: options.now,
  };
  transaction.create(invoiceReference, {
    id: options.invoiceId,
    tenantId,
    projectId: project.id,
    kind: "final",
    provider,
    providerInvoiceId: readyForProviderDraft ? `pending_${options.invoiceId}` : null,
    providerCustomerId: customerId,
    status: readyForProviderDraft ? "draft" : "review_required",
    currency: packageSnapshot.get("currency"),
    amountCents,
    balanceCents: amountCents,
    dueDate: date(due),
    hostedUrl: null,
    lastSyncedAt: options.now,
    lastProviderEventId: null,
    providerState: readyForProviderDraft ? "queued" : "review_required",
    calculation,
    createdAt: options.now,
    updatedAt: options.now,
    createdBy: options.actor,
    updatedBy: options.actor,
    archivedAt: null,
  });
  if (readyForProviderDraft) {
    transaction.create(db.doc(`providerJobs/invoice_${options.invoiceId}`), {
      id: `invoice_${options.invoiceId}`,
      tenantId,
      projectId: project.id,
      type: provider === "stripe" ? "create_stripe_invoice" : "create_quickbooks_invoice",
      invoiceId: options.invoiceId,
      idempotencyKey: `final-invoice-${options.invoiceId}`,
      status: "queued",
      attempts: 0,
      createdAt: options.now,
      updatedAt: options.now,
    });
  }
  return { raised: true, invoiceId: options.invoiceId, amountCents, reviewRequired: !readyForProviderDraft };
}
