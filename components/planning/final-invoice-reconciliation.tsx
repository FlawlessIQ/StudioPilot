"use client";

import { Calculator, CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
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

export function FinalInvoiceReconciliation() {
  const { records, loading } = useTenantDocuments("invoiceReferences");
  const finalInvoices =
    records?.filter((invoice) => invoice.kind === "final") ?? [];

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
      {loading ? <p className="panel">Loading final-invoice evidence…</p> : null}
      {!loading && !finalInvoices.length ? (
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
                    <strong>Provider evidence needs attention</strong>
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
