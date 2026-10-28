import { tradeProfile } from "../trades/trades.js";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { retainerFromSchedule } from "./agreed-retainer.js";
import { isStandingInvoice } from "./invoice-standing.js";
import { finalBillBasis, quickBooksIsTaxAuthority } from "./final-tax-authority.js";
import { combinedSnapshot, readJobSnapshots } from "../packages/combined-snapshot.js";
import type { JobBilling } from "../billing/job-billing.js";
import { writeStudioInvoiceDraft } from "../billing/studio-invoice-issue.js";
import { invoiceRecordsDeleted } from "../billing/invoice-purge-policy.js";
import { normaliseStudioInvoiceSettings, studioInvoiceTaxCents } from "../billing/studio-invoice-settings.js";
import { installmentLabel, installmentsBilledCents, nextInstallmentToBill } from "../billing/payment-plan.js";

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
 *
 * On a payment plan (billing/payment-plan.ts) every installment billed comes
 * off too — paid or not, since each is owed on its own bill — so the final is
 * what is left, and one raised early takes in the installments not yet
 * billed. The daily run raises no installment once a final stands.
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
    /**
     * A job paid on the day or invoiced after the event (job-kinds.ts): it
     * booked with nothing paid, so there is no retainer to bill after, and
     * this one invoice is the whole price.
     */
    billedWithoutRetainer?: boolean;
    /** When the bill is due; two weeks before the event when omitted. */
    dueDate?: string;
    /**
     * The daily run only: on a payment plan with an installment still to be
     * billed, the final waits for it (billing/payment-plan.ts). A person's
     * Send, or a booking change, bills the rest now and takes it in.
     */
    waitForInstallments?: boolean;
    /**
     * How the job is billed (billing/job-billing-reader.ts jobBillingFor),
     * read by the caller before the transaction. A job the studio bills
     * itself is never sent to QuickBooks from here.
     */
    billing: JobBilling;
  },
): Promise<FinalInvoiceOutcome> {
  const studioBilled = options.billing.method === "studio";
  // The studio deleted invoice records on this job: what was paid is no
  // longer known, so no balance is worked out from what's left (own
  // invoicing, Phase 5 — invoice-purge-policy.ts).
  if (invoiceRecordsDeleted(project.data())) return { raised: false, reason: "records_deleted" };
  const tenantId = String(project.get("tenantId") ?? "");
  const invoiceReference = db.doc(`invoiceReferences/${options.invoiceId}`);
  if ((await transaction.get(invoiceReference)).exists) return { raised: false, reason: "exists" };
  const tenant = await transaction.get(db.doc(`tenants/${tenantId}`));
  const snapshotId = String(project.get("packageSnapshotId") ?? "");
  if (!snapshotId) return { raised: false, reason: "no_package" };
  // Every package on the job, for the fallback below when no proposal was
  // accepted (packages/combined-snapshot.ts) — the primary alone forgave the rest.
  const jobSnapshots = await readJobSnapshots(db, project.data(), tenantId, (reference) => transaction.get(reference));
  if (!jobSnapshots.length) return { raised: false, reason: "no_package" };
  const packageSnapshot = combinedSnapshot(jobSnapshots);
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
  /**
   * Every retainer on the job, not the first one found. An import with some
   * paid and some still owed has two (imports/existing-booking.ts): the final
   * took off one of them, so it overcharged by the other — or asked for the
   * whole total when the one it found was the owed one, still unpaid
   * (imported-job walk, 2026-10-27). The one that names a customer bills.
   */
  const retainers = standing.filter((invoice) => invoice.get("kind") === "retainer");
  const retainer = retainers.find((invoice) => invoice.get("providerCustomerId")) ?? retainers[0] ?? null;
  /**
   * A retainer the studio waived is a retainer satisfied, with nothing paid.
   *
   * Booking on an approved retainer exception leaves no retainer invoice, so
   * this refused with `no_retainer` and the studio was told to "record the
   * retainer first" — money that was never received — while Today and
   * Invoices offered Send (money audit, 2026-09-30). The exception is the
   * studio's recorded decision; the balance is then the whole agreed total.
   */
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
  // An import with nothing paid and nothing owed booked on paper: there is no
  // retainer record to bill after, and its balance is the whole total.
  if (!retainer && !waiver && !options.billedWithoutRetainer && !project.get("importedAt"))
    return { raised: false, reason: "no_retainer" };
  // Billed by whoever billed the retainer; a retainer recorded by hand names
  // no provider, and then the studio's invoicing provider decides. Before
  // this, every final went to QuickBooks — a Stripe studio's final carried a
  // Stripe customer id into QuickBooks and failed there.
  // A job the studio bills itself (billing/job-billing.ts) has no provider
  // and no provider customer: its final is drafted below as the studio's own
  // invoice, numbered with its PDF, for the studio to send.
  const retainerProvider = String(retainer?.get("provider") ?? "");
  const provider: "quickbooks" | "stripe" =
    retainerProvider === "stripe" || retainerProvider === "quickbooks"
      ? retainerProvider
      : (options.provider ?? "quickbooks");
  const retainerCustomer = retainer?.get("providerCustomerId");
  let customerId = "";
  if (studioBilled) customerId = "";
  else if (typeof retainerCustomer === "string" && retainerCustomer && retainerProvider === provider) customerId = retainerCustomer;
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
  if (
    options.waitForInstallments &&
    nextInstallmentToBill({
      schedule: accepted?.get("paymentSchedule"),
      invoices: invoices.map((invoice) => invoice.data() as Record<string, unknown>),
      today: options.now.slice(0, 10),
      ignoreDate: true,
    })
  )
    return { raised: false, reason: "installments_pending" };
  const agreedPricing = (accepted?.get("pricingSnapshot") ?? null) as Record<string, unknown> | null;
  const agreedTotal = Number(agreedPricing?.totalCents);
  const fromProposal = Boolean(accepted && Number.isSafeInteger(agreedTotal) && agreedTotal > 0);
  const source = fromProposal ? `proposals/${accepted!.id}` : `packageSnapshots/${snapshotId}`;
  const agreedTotalCents = fromProposal ? agreedTotal : Number(packageSnapshot.get("totalCents") ?? 0);
  const agreedTaxCents = fromProposal
    ? Number(agreedPricing?.taxCents ?? 0)
    : Number(packageSnapshot.get("taxCents") ?? 0);
  // QuickBooks as the sales-tax authority (switched-on studios): the balance
  // is raised pre-tax and QuickBooks adds the tax — final-tax-authority.ts.
  const quickBooksTax = studioBilled ? false : await quickBooksIsTaxAuthority(db, transaction, tenantId, provider);
  const basis = finalBillBasis({ totalCents: agreedTotalCents, agreedTaxCents, quickBooksTax });
  // The studio's own rate on the whole agreed price (Settings → Invoices),
  // in place of any QuickBooks estimate the proposal carried; none on a job
  // exempted from sales tax.
  let studioSettings: ReturnType<typeof normaliseStudioInvoiceSettings> | null = null;
  if (studioBilled) {
    const settingsDoc = await transaction.get(db.doc(`billingSettings/${tenantId}`));
    studioSettings = normaliseStudioInvoiceSettings(
      settingsDoc.exists && settingsDoc.get("tenantId") === tenantId ? settingsDoc.data() : null,
    );
  }
  const studioPreTaxCents = agreedTotalCents - (Number.isSafeInteger(agreedTaxCents) ? agreedTaxCents : 0);
  const studioTaxCents =
    studioSettings && project.get("salesTaxExempt") !== true ? studioInvoiceTaxCents(studioPreTaxCents, studioSettings) : 0;
  const totalCents = studioBilled ? studioPreTaxCents + studioTaxCents : basis.billedTotalCents;
  const taxCents = studioBilled ? studioTaxCents : basis.taxCents;
  // Waived: nothing was expected, so nothing paid is not a discrepancy.
  const retainerExpectedCents = retainer
    ? retainerFromSchedule(
        accepted?.get("paymentSchedule"),
        Number(packageSnapshot.get("retainerCents") ?? 0),
      )
    : 0;
  const retainerPaidCents = retainers.reduce((sum, invoice) => sum + paidOf(invoice), 0);
  // A retainer still owed is billed on its own bill, as an installment is:
  // the final leaves it there rather than asking for it twice.
  const retainerOpenCents = retainers.reduce(
    (sum, invoice) => sum + Math.max(0, Number(invoice.get("amountCents") ?? 0) - paidOf(invoice)),
    0,
  );
  const earlierFinalsPaidCents = standing
    .filter((invoice) => invoice.get("kind") === "final")
    .reduce((sum, invoice) => sum + paidOf(invoice), 0);
  // A payment plan's installments, each billed on its own (billing/payment-plan.ts).
  const installments = standing
    .filter((invoice) => invoice.get("kind") === "installment")
    .sort((a, b) => Number(a.get("installmentSequence") ?? 0) - Number(b.get("installmentSequence") ?? 0));
  const installmentsCents = installmentsBilledCents(installments.map((invoice) => invoice.data() as Record<string, unknown>));
  const amountCents = totalCents - retainerPaidCents - retainerOpenCents - earlierFinalsPaidCents - installmentsCents;
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(amountCents) || amountCents <= 0)
    return { raised: false, reason: "nothing_owed" };

  const discrepancies: string[] = [];
  if (retainerPaidCents !== retainerExpectedCents) discrepancies.push("RETAINER_EVIDENCE_MISMATCH");
  const readyForProviderDraft = discrepancies.length === 0;
  const due = new Date(`${options.dueDate ?? String(project.get("eventDate"))}T00:00:00Z`);
  // Two weeks before, or on the day for a makeup artist or hair stylist (trades.ts).
  if (!options.dueDate) due.setUTCDate(due.getUTCDate() - tradeProfile(tenant.get("trade")).balanceDueDaysBefore);
  // Raised after that day (a job booked or imported late): due today, not on a
  // date already gone — an invoice raised Oct 23 read "due Oct 17" (2026-10-23).
  const todayIso = options.now.slice(0, 10);
  if (due.toISOString().slice(0, 10) < todayIso) due.setTime(Date.parse(`${todayIso}T00:00:00Z`));
  const calculation = {
    lines: [
      { label: "Approved package and add-ons", amountCents: totalCents - taxCents, source },
      quickBooksTax
        ? { label: "Sales tax — calculated by QuickBooks when the invoice is made", amountCents: 0, source: "quickbooks" }
        : { label: "Approved tax", amountCents: taxCents, source },
      retainer
        ? {
            label: retainers.length > 1 ? "Retainer payments received" : "Retainer payment received",
            amountCents: -retainerPaidCents,
            source: retainers.length > 1 ? "invoiceReferences" : `invoiceReferences/${retainer.id}`,
          }
        : waiver
          ? {
              label: "Retainer waived by the studio",
              amountCents: 0,
              source: `bookingExceptions/${waiver.id}`,
            }
          : {
              label: "Nothing was paid to book this job",
              amountCents: 0,
              source: "job_kind",
            },
      ...(retainerOpenCents
        ? [{ label: "Retainer still owed, billed separately", amountCents: -retainerOpenCents, source: "invoiceReferences" }]
        : []),
      ...(earlierFinalsPaidCents
        ? [{ label: "Earlier balance payments received", amountCents: -earlierFinalsPaidCents, source: "invoiceReferences" }]
        : []),
      ...(installmentsCents
        ? [{ label: "Installments, billed separately", amountCents: -installmentsCents, source: "invoiceReferences" }]
        : []),
    ],
    packageTotalCents: totalCents,
    // The tax inside packageTotalCents, so the QuickBooks invoice can show the
    // packages at full price and the tax on top (quickbooks-invoice-lines.ts).
    // 0 when QuickBooks is the tax authority: it adds the tax itself.
    taxCents,
    ...(quickBooksTax
      ? { taxAuthority: "quickbooks", agreedTaxExcludedCents: basis.agreedTaxExcludedCents }
      : {}),
    retainerExpectedCents,
    retainerPaidCents,
    ...(installmentsCents ? { installmentsCents } : {}),
    expectedBalanceCents: amountCents,
    discrepancies,
    authority: studioBilled ? "studio" : provider,
    requiresHumanReview: true,
    calculatedAt: options.now,
  };
  if (studioBilled) {
    // The agreed price as the line, taxed whole (above); what was paid
    // towards it before is printed with the payments, after the total, so
    // the tax reads against the price it was worked out on.
    const packageName = String(packageSnapshot.get("packageName") ?? "") || "Your booking";
    const lines = [
      { description: packageName, quantity: 1, unitAmountCents: studioPreTaxCents, amountCents: studioPreTaxCents },
    ];
    const credits = [
      ...(retainerPaidCents
        ? [{ description: `Deposit paid${retainers.length === 1 && retainer?.get("number") ? ` (${String(retainer.get("number"))})` : ""}`, amountCents: retainerPaidCents }]
        : []),
      ...(retainerOpenCents ? [{ description: "Deposit, billed separately", amountCents: retainerOpenCents }] : []),
      ...(earlierFinalsPaidCents ? [{ description: "Earlier balance payments", amountCents: earlierFinalsPaidCents }] : []),
      // Each installment of a payment plan: paid, or billed on its own.
      ...installments.map((invoice) => {
        const number = invoice.get("number") ? ` (${String(invoice.get("number"))})` : "";
        const label = installmentLabel(Number(invoice.get("installmentSequence") ?? 1));
        return {
          description:
            paidOf(invoice) >= Number(invoice.get("amountCents") ?? 0)
              ? `${label} paid${number}`
              : `${label}, billed separately${number}`,
          amountCents: Number(invoice.get("amountCents") ?? 0),
        };
      }),
    ];
    const written = await writeStudioInvoiceDraft(db, transaction, {
      tenantId,
      projectId: project.id,
      invoiceId: options.invoiceId,
      draft: {
        kind: "final",
        paidInFull: false,
        subtotalCents: amountCents - taxCents,
        completesPrice: true,
        taxCents,
        lines,
        currency: String(packageSnapshot.get("currency") ?? "USD"),
        dueDate: date(due),
        // The studio checks the draft before sending; a mismatch is kept
        // on record for it, as a QuickBooks final would be held.
        extra: { calculation, credits },
      },
      actor: options.actor,
      now: options.now,
    });
    if (!written.created) return { raised: false, reason: "exists" };
    return { raised: true, invoiceId: options.invoiceId, amountCents, reviewRequired: false };
  }
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
