"use client";

import { Calculator, CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { FinalBalanceActions } from "@/components/booking/final-balance-actions";
import { StudioInvoiceActions } from "@/components/booking/studio-invoice-actions";
import { outstandingFinalBalance } from "@/features/booking/final-balance-due";
import { studioTaxRateFor } from "@/features/billing/job-billing-from-records";
import { balanceMayBeAttested } from "@/features/booking/agreed-final-balance";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApproveFinalInvoice, RecordInvoicePayment, VoidInvoice } from "@/components/booking/invoice-corrections";
import { statusLabel } from "@/features/format/status-label";
import { InfoHint } from "@/components/ui/info-hint";
import { ProviderInvoiceLines } from "@/components/booking/provider-invoice-lines";
import { HeldInvoiceReview } from "@/components/booking/held-invoice-review";
import { heldInvoiceView } from "@/features/billing/held-invoice-review";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const money = (value: unknown, currency: unknown) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "USD"),
  }).format(Number(value ?? 0) / 100);

export function FinalInvoiceReconciliation({ projectId }: { projectId?: string }) {
  const { records, loading } = useTenantDocuments("invoiceReferences");
  const { records: projects } = useTenantDocuments("projects");
  const { records: proposals } = useTenantDocuments("proposals");
  const { records: connections } = useTenantDocuments("integrationConnections");
  const { records: billingSettings } = useTenantDocuments("billingSettings");
  const [settled, setSettled] = useState<string | null>(null);
  // Arrived from one job whose balance nothing has billed: the actions, not a
  // note that the scheduler will get to it (it may never — see
  // components/booking/final-balance-actions.tsx).
  const project = projectId ? projects?.find((candidate) => candidate.id === projectId) : undefined;
  const due =
    project && balanceMayBeAttested(String(project.state ?? "")) && !project.archivedAt
      ? outstandingFinalBalance({
          projectId: project.id,
          proposals,
          invoices: records,
          // A job the studio bills itself: what its own final will carry.
          studioTaxBasisPoints: studioTaxRateFor({
            projectId: project.id,
            project,
            connections,
            invoices: records,
            billingSettings: billingSettings?.find((record) => record.tenantId === project.tenantId) ?? null,
          }),
        })
      : null;
  const unbilled = due && !due.finalStanding && due.cents ? due : null;
  const finalInvoices =
    records?.filter(
      (invoice) =>
        invoice.kind === "final" &&
        (!projectId || String(invoice.projectId) === projectId),
    ) ?? [];

  return (
    <section className="final-invoice-reconciliation">
      <header className="section-heading-row">
        <div>
          <p className="eyebrow">Explainable accounting</p>
          <h2>
            Final invoice review
            <InfoHint label="Final invoice review">
              Final bills are raised automatically 28 days before the event when the retainer was invoiced in
              QuickBooks or Stripe. Anything else is billed from Today.
            </InfoHint>
          </h2>
          <p>
            StudioCue prepares the arithmetic. On a QuickBooks job, QuickBooks
            stays authoritative for the invoice, tax and payments; on a job you
            bill yourself, the invoice is your own, numbered with its PDF.
          </p>
        </div>
        <Calculator aria-hidden="true" />
      </header>
      {loading ? <p className="panel">Loading the final invoice…</p> : null}
      {!loading && unbilled && project ? (
        <article className="panel final-invoice-unbilled">
          <span>
            <strong>{`${String(project.name ?? "This job")}'s final balance hasn't been billed`}</strong>
            <small>
              {`${money(unbilled.cents, "USD")} is left to pay${
                unbilled.dueDate ? `, due ${new Date(`${unbilled.dueDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : ""
              }. Send the bill, or record it if they paid another way.`}
            </small>
            {unbilled.lastFailure ? (
              <small className="form-error" role="alert">{`The last try didn't go through. ${unbilled.lastFailure}`}</small>
            ) : null}
          </span>
          <FinalBalanceActions
            balanceLabel={money(unbilled.cents, "USD")}
            onDone={setSettled}
            packageSnapshotId={typeof project.packageSnapshotId === "string" ? project.packageSnapshotId : null}
            projectId={project.id}
          />
        </article>
      ) : null}
      {settled && !unbilled ? (
        <p className="form-notice" role="status">
          {settled}
        </p>
      ) : null}
      {!loading && !finalInvoices.length && !unbilled ? (
        <article className="panel final-invoice-empty">
          <ShieldCheck />
          <span>
            <strong>No final invoice is due for preparation yet.</strong>
            <small>
              StudioCue starts the review 28 days before an eligible event.
            </small>
          </span>
        </article>
      ) : null}
      <div className="final-invoice-list">
        {finalInvoices.map((invoice) => {
          const calculation = record(invoice.calculation);
          const lines = list(calculation.lines).map(record);
          const discrepancies = list(calculation.discrepancies).map(String);
          const inReview = invoice.status === "review_required";
          const provider = invoice.provider === "stripe" ? "Stripe" : "QuickBooks";
          // An invoice the studio issued itself (own invoicing): its own
          // number, PDF and send buttons in place of the provider's state.
          const studioIssued = invoice.billedBy === "studio" && !invoice.provider;
          // In QuickBooks already, waiting on the tax check: its own figures
          // (QuickBooks' total) and its own buttons.
          const held = heldInvoiceView(invoice);
          // The balance as it stands now, for a bill held for review: what
          // the studio confirms is what the server sends (it re-checks).
          // Pre-tax where QuickBooks adds the tax (final-tax-authority.ts).
          const reviewDue =
            inReview && !held
              ? outstandingFinalBalance({
                  projectId: String(invoice.projectId),
                  proposals,
                  invoices: records,
                  excludeAgreedTax: calculation.taxAuthority === "quickbooks",
                }).cents
              : null;
          return (
            // The row on Invoices links here ("Check and send"), and names the
            // job rather than its id (prod walk, 2026-09-30).
            <article className="panel final-invoice-card" id={`final-invoice-${invoice.id}`} key={invoice.id}>
              <header>
                <span>
                  <small>
                    {String(
                      projects?.find((candidate) => candidate.id === String(invoice.projectId))?.name ??
                        "Final bill",
                    )}
                  </small>
                  <strong>
                    Final balance{" "}
                    {money(
                      // Held for review: the balance as it stands now, the
                      // same figure the send button carries. It said the
                      // amount from when the bill was raised, so the card
                      // read $1,899 above a "Send · $1,898" button after a
                      // payment came in (prod walk, 2026-09-30).
                      held
                        ? held.totalCents
                        : inReview && reviewDue !== null
                          ? reviewDue
                          : calculation.expectedBalanceCents ?? invoice.amountCents,
                      invoice.currency,
                    )}
                  </strong>
                  {inReview &&
                  reviewDue !== null &&
                  reviewDue !== Number(calculation.expectedBalanceCents ?? invoice.amountCents) ? (
                    <small>
                      {`Was ${money(calculation.expectedBalanceCents ?? invoice.amountCents, invoice.currency)} when it was raised; payments since are taken off.`}
                    </small>
                  ) : null}
                  {/* Part paid: the figure above is the bill, this is what is
                      still owed on it (and what autopay would charge). */}
                  {invoice.status === "partially_paid" ? (
                    <small>{`${money(invoice.balanceCents, invoice.currency)} left to pay.`}</small>
                  ) : null}
                </span>
                <StatusBadge
                  tone={inReview ? "warning" : invoice.status === "paid" ? "success" : "neutral"}
                >
                  {inReview ? "Review required" : statusLabel(invoice.status)}
                </StatusBadge>
              </header>
              {/* StudioCue's working, shown only until the provider has the
                  bill. After that, the lines QuickBooks received (below) are
                  the bill. Shown together, the working's "Sales tax —
                  calculated by QuickBooks when the invoice is made · $0.00"
                  sat above QuickBooks' real $582.87, and GR voided a correct
                  final for having "no sales tax" (2026-10-09). */}
              {list(record(invoice.providerLines).lines).length ? null : (
                <div className="invoice-calculation-lines">
                  {lines.map((line) => (
                    <span key={`${String(line.label)}-${String(line.source)}`}>
                      <small>{String(line.label)}</small>
                      <strong>
                        {line.source === "quickbooks" && !Number(line.amountCents)
                          ? "Added by QuickBooks"
                          : money(line.amountCents, invoice.currency)}
                      </strong>
                    </span>
                  ))}
                </div>
              )}
              {/* Once created: the lines QuickBooks received (packages at
                  full price, the retainer taken off, tax on the full
                  package), and a warning when it billed a different total. */}
              <ProviderInvoiceLines invoice={invoice} />
              {held ? (
                /* In QuickBooks, unsent: QuickBooks' tax, and the studio's
                   choice — with tax, without, or Edit. */
                <HeldInvoiceReview invoice={invoice} onDone={setSettled} />
              ) : inReview ? (
                /* Held, not sent: nothing went to the provider. This was a
                   badge and nothing else, so a held bill sat here for good
                   while Today stopped offering to send one. */
                <div className="invoice-discrepancies">
                  <CircleAlert />
                  <span>
                    <strong>This bill is held for you to check before it goes</strong>
                    {discrepancies.map((issue) => (
                      <small key={issue}>
                        {issue === "RETAINER_EVIDENCE_MISMATCH"
                          ? `The retainer on record (${money(calculation.retainerPaidCents, invoice.currency)}) isn't what was agreed (${money(calculation.retainerExpectedCents, invoice.currency)}). If a payment was recorded wrongly, correct it on Invoices first.`
                          : issue.replaceAll("_", " ").toLocaleLowerCase()}
                      </small>
                    ))}
                  </span>
                </div>
              ) : studioIssued ? (
                <StudioInvoiceActions invoice={invoice} onDone={setSettled} />
              ) : (
                <div className="invoice-ready">
                  <CheckCircle2 />
                  <span>
                    <strong>Arithmetic reconciled</strong>
                    {/* It used to say "Human review is still required before
                        the provider draft is sent" on every bill — including
                        ones already sent, where no review was coming. */}
                    <small>
                      {invoice.status === "paid"
                        ? "Paid."
                        : ["draft", "queued"].includes(String(invoice.status))
                          ? calculation.taxAuthority === "quickbooks"
                            ? `On its way to ${provider}, which works out the sales tax. You'll check it before anything goes to the couple.`
                            : `On its way to ${provider}, which creates it and emails it to the couple.`
                          : ["voided", "superseded", "failed"].includes(String(invoice.status))
                            ? "No longer billed."
                            : `With the couple through ${provider}.`}
                    </small>
                  </span>
                </div>
              )}
              {inReview && !held ? (
                <ApproveFinalInvoice amountCents={reviewDue} invoice={invoice} onDone={setSettled} />
              ) : null}
              <RecordInvoicePayment invoice={invoice} onDone={setSettled} />
              {/* A held bill's Edit is its void. */}
              {held ? null : <VoidInvoice invoice={invoice} onDone={setSettled} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}
