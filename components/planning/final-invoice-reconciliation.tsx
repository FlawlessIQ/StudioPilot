"use client";

import { Calculator, CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { FinalBalanceActions } from "@/components/booking/final-balance-actions";
import { outstandingFinalBalance } from "@/features/booking/final-balance-due";
import { balanceMayBeAttested } from "@/features/booking/agreed-final-balance";
import { StatusBadge } from "@/components/ui/status-badge";

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
  const [settled, setSettled] = useState<string | null>(null);
  // Arrived from one job whose balance nothing has billed: the actions, not a
  // note that the scheduler will get to it (it may never — see
  // components/booking/final-balance-actions.tsx).
  const project = projectId ? projects?.find((candidate) => candidate.id === projectId) : undefined;
  const due =
    project && balanceMayBeAttested(String(project.state ?? "")) && !project.archivedAt
      ? outstandingFinalBalance({ projectId: project.id, proposals, invoices: records })
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
          <h2>Final invoice review</h2>
          <p>
            StudioCue prepares the arithmetic; QuickBooks remains authoritative
            for the invoice, balance, tax, and payment evidence.
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
          return (
            <article className="panel final-invoice-card" key={invoice.id}>
              <header>
                <span>
                  <small>Project {String(invoice.projectId)}</small>
                  <strong>
                    Final balance{" "}
                    {money(
                      calculation.expectedBalanceCents ?? invoice.amountCents,
                      invoice.currency,
                    )}
                  </strong>
                </span>
                <StatusBadge
                  tone={discrepancies.length ? "warning" : "success"}
                >
                  {discrepancies.length
                    ? "Review required"
                    : "Ready for QuickBooks"}
                </StatusBadge>
              </header>
              <div className="invoice-calculation-lines">
                {lines.map((line) => (
                  <span key={`${String(line.label)}-${String(line.source)}`}>
                    <small>
                      {String(line.label)}
                      <em>{String(line.source)}</em>
                    </small>
                    <strong>{money(line.amountCents, invoice.currency)}</strong>
                  </span>
                ))}
              </div>
              {discrepancies.length ? (
                <div className="invoice-discrepancies">
                  <CircleAlert />
                  <span>
                    <strong>The final invoice needs a look</strong>
                    {discrepancies.map((issue) => (
                      <small key={issue}>
                        {issue.replaceAll("_", " ").toLocaleLowerCase()}
                      </small>
                    ))}
                  </span>
                </div>
              ) : (
                <div className="invoice-ready">
                  <CheckCircle2 />
                  <span>
                    <strong>Arithmetic reconciled</strong>
                    <small>
                      Human review is still required before the provider draft
                      is sent.
                    </small>
                  </span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
