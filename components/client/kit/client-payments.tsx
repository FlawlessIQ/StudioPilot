"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileText, LockKeyhole, MessageCircle, RotateCw } from "lucide-react";
import { resolveFile } from "@/lib/documents/resolve-file";
import { Actions, Button, Card, List, Main, Pill, PoweredBy, Row, Steps } from "@/components/kit/kit";
import { ClientAutopay } from "@/components/client/client-autopay";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeVocab } from "@/features/trades/trades";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import { readPricedSalesTax } from "@/features/billing/sales-tax-pricing";
import { morningBalance } from "@/features/billing/balance-on-the-day";
import { invoicePayNote, invoicePayRoute } from "@/features/client/invoice-pay-route";
import { statusLabel } from "@/features/format/status-label";
import {
  date,
  invoiceOverdue,
  money,
  number,
  text,
  useProject,
  useProjectRecords,
  useReserveYourDate,
} from "@/components/client/live-client-views";
import { EmptyMoment } from "@/components/client/kit/empty-moment";
import { InfoHint } from "@/components/ui/info-hint";
import { todayLocalIso } from "@/lib/format/event-date";
import { installmentName } from "@/features/billing/payment-plan";
import { paymentPlanRows, type PlanScheduleRow } from "@/features/billing/payment-plan-view";

/**
 * "retainer" and "final" are the system's words, not a couple's — and a
 * vendor's client pays a deposit (trades.ts `deposit`).
 */
function invoiceName(kind: unknown, trade?: unknown, invoice?: Record<string, unknown>): string {
  const value = text(kind, "");
  if (value === "retainer") {
    const word = tradeVocab(trade).deposit;
    return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  }
  // A payment plan's: "Installment 2 of 3" (features/billing/payment-plan.ts).
  if (value === "installment")
    return installmentName(number(invoice?.installmentSequence) || 1, number(invoice?.installmentCount) || null);
  if (value === "final") return "Final balance";
  return value ? value.replace(/^\w/, (c) => c.toUpperCase()) : "Invoice";
}

/** A payment plan line's when, in the client's words. */
function planRowWhen(row: PlanScheduleRow): string {
  if (row.state === "in_final") return "Included in your final balance";
  const when = row.dueDate ? `due ${date(row.dueDate)}` : "due on signing";
  if (row.state === "billed") return `Invoice sent · ${when}`;
  return when.charAt(0).toUpperCase() + when.slice(1);
}

/**
 * What's owed, and one way to pay it (M3 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * The amount due next leads, with a single sticky button to the studio's
 * secure invoice (Stripe or QuickBooks: StudioCue never sees card details),
 * then the whole schedule. After paying, the couple comes back and the page
 * re-checks on its own, as before.
 */
/**
 * The day an invoice was paid. A payment the studio recorded by hand is a
 * calendar date stored as midnight UTC, so it is read as that date — read as
 * an instant it fell on the evening before in America. A provider's paid
 * time is a real instant.
 */
export function paidOn(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(value) ? value.slice(0, 10) : value;
}

export function ClientPayments() {
  const workspace = useWorkspace();
  const invoices = useProjectRecords("invoiceReferences");
  const proposals = useProjectRecords("proposals");
  const project = useProject().value;
  const reserve = useReserveYourDate();
  const [openedInvoiceId, setOpenedInvoiceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshInvoices = invoices.refresh;
  /** The invoice PDF's link, when the browser wouldn't open a tab for it. */
  const [invoiceLink, setInvoiceLink] = useState<string | null>(null);

  /**
   * The studio's own invoice, as a PDF (own invoicing): opened through the
   * Storage rules like any client file, in a tab opened while the tap still
   * counts as one.
   */
  async function openInvoicePdf(invoice: Record<string, unknown>) {
    const path = typeof invoice.pdfStoragePath === "string" ? invoice.pdfStoragePath : "";
    if (!path) return;
    setNotice(null);
    const tab = window.open("", "_blank");
    const result = await resolveFile(
      { kind: "storage", path, label: `Invoice ${text(invoice.number)}`.trim() },
      workspace.tenantId ?? null,
    );
    if (result.status !== "ready") {
      tab?.close();
      setNotice(result.message);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.url;
    } else {
      // Pop-ups blocked: a plain link still opens it on a tap.
      setInvoiceLink(result.url);
    }
  }

  useEffect(() => {
    if (!openedInvoiceId) return;
    const checkOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      setNotice("Checking for your latest payment status…");
      refreshInvoices?.();
    };
    window.addEventListener("focus", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    return () => {
      window.removeEventListener("focus", checkOnReturn);
      document.removeEventListener("visibilitychange", checkOnReturn);
    };
  }, [openedInvoiceId, refreshInvoices]);

  const standing = useMemo(
    () =>
      invoices.value
        .filter((invoice) => isStandingInvoice(invoice.status))
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
    [invoices.value],
  );
  const due = standing.find((invoice) => number(invoice.balanceCents) > 0) ?? null;
  // Agreed pre-tax "plus sales tax" (QuickBooks works it out): until the final
  // invoice exists, say the balance to come carries the tax.
  const agreedSalesTax = useMemo(() => {
    const accepted = proposals.value
      .filter((proposal) => proposal.status === "accepted")
      .sort((left, right) => number(right.version) - number(left.version))[0];
    const pricing = accepted?.pricingSnapshot;
    return readPricedSalesTax(pricing && typeof pricing === "object" ? (pricing as Record<string, unknown>).salesTax : null);
  }, [proposals.value]);
  const finalRaised = standing.some((invoice) => invoice.kind === "final");
  /**
   * A payment plan (features/billing/payment-plan.ts): every payment agreed —
   * the deposit, each installment, the final balance — paid, billed, or still
   * to come. Without it the page listed only the bills already out, and said
   * "All paid" between installments.
   */
  const depositWord = tradeVocab(workspace.tenantTrade).deposit;
  const planRows = useMemo(() => {
    const accepted = proposals.value
      .filter((proposal) => proposal.status === "accepted")
      .sort((left, right) => number(right.version) - number(left.version))[0];
    return paymentPlanRows({
      schedule: accepted?.paymentSchedule,
      invoices: invoices.value,
      depositWord: `${depositWord.charAt(0).toUpperCase()}${depositWord.slice(1)}`,
    });
  }, [proposals.value, invoices.value, depositWord]);
  const nextPlanned = planRows.find((row) => row.state === "upcoming") ?? null;
  const planCurrency = text(standing[0]?.currency, "USD");
  /**
   * A makeup artist's or hair stylist's client pays the rest on the morning
   * (features/billing/balance-on-the-day.ts). No invoice is sent for it, so
   * without this the page said "All paid" with the balance still to come.
   */
  const morning = useMemo(
    () =>
      morningBalance({
        project,
        trade: workspace.tenantTrade,
        proposals: proposals.value,
        invoices: invoices.value,
        today: todayLocalIso(),
      }),
    [project, workspace.tenantTrade, proposals.value, invoices.value],
  );
  const plusTax = Boolean(agreedSalesTax && !agreedSalesTax.exempt);
  const morningAmount = morning ? money(morning.amountCents, morning.currency) : null;
  const hostedUrl = due && typeof due.hostedUrl === "string" && due.hostedUrl ? due.hostedUrl : null;
  // An invoice the studio issued itself has no accounting app behind it: its
  // pay link is the studio's own page (own invoicing).
  const provider = due
    ? text(due.provider) === "stripe"
      ? "Stripe"
      : text(due.provider) === "quickbooks"
        ? "QuickBooks"
        : null
    : null;
  const instructions = due && typeof due.paymentInstructions === "string" ? due.paymentInstructions : null;
  // Online, paid to the studio directly (an invoice with no pay link, and
  // none coming), or genuinely still being created.
  const payRoute = due ? invoicePayRoute({ hostedUrl, atProvider: due.atProvider }) : null;
  const studioName =
    workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : null;
  const payNote =
    due && payRoute
      ? invoicePayNote(payRoute, {
          studioName,
          invoiceName: invoiceName(due.kind, workspace.tenantTrade, due),
          providerName: provider,
          hasInstructions: payRoute === "direct" && Boolean(instructions),
        })
      : null;

  if (invoices.error || (standing.length === 0 && !morning))
    return (
      <Main label="Payments">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Payments</p>
          <h1 className="kit-title">Your payments</h1>
        </div>
        <EmptyMoment
          area="payments"
          error={invoices.error}
          loading={invoices.loading}
          loadingText="Opening your payments…"
          upcoming="Invoices will appear here when your studio creates them."
        />
        <PoweredBy />
      </Main>
    );

  return (
    <>
      <Main label="Payments">
        {reserve ? (
          <div className="kit-stack-tight">
            <Steps step={reserve.steps.filter((step) => step.state === "done").length} total={reserve.steps.length} />
            <p className="kit-caption">Reserve your date · {reserve.next.title}</p>
          </div>
        ) : null}
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Payments</p>
          <h1 className="kit-title">{due || morning || nextPlanned ? "Your next payment" : "All paid"}</h1>
        </div>

        {due ? (
          <Card tone="accent">
            <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
              {invoiceName(due.kind, workspace.tenantTrade, due)} · {invoiceOverdue(due) ? "overdue" : `due ${date(due.dueDate)}`}
            </p>
            <p className="kit-amount">{money(due.balanceCents, due.currency)}</p>
            {number(due.balanceCents) < number(due.amountCents) ? (
              <p className="kit-caption">
                Of {money(due.amountCents, due.currency)} · the rest is already paid.
              </p>
            ) : null}
            {payRoute === "online" ? (
              <p className="kit-caption">
                <LockKeyhole aria-hidden size={14} /> {payNote}
              </p>
            ) : (
              <p className="kit-caption">{payNote}</p>
            )}
            {instructions ? <p className="kit-body client-pay-instructions">{instructions}</p> : null}
            {typeof due.pdfStoragePath === "string" ? (
              invoiceLink ? (
                <a className="kit-button" data-variant="secondary" href={invoiceLink} rel="noreferrer" target="_blank">
                  <FileText aria-hidden size={20} />
                  {`Open invoice ${text(due.number)}`.trim()}
                </a>
              ) : (
                <Button icon={FileText} onClick={() => void openInvoicePdf(due)} variant="secondary">
                  {`Download invoice ${text(due.number)}`.trim()}
                </Button>
              )
            ) : null}
            {notice ? (
              <p className="kit-caption" role="status">
                {notice}
              </p>
            ) : null}
          </Card>
        ) : morning ? (
          <Card tone="accent">
            <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
              Balance · {morning.eventDate ? `the morning of ${date(morning.eventDate)}` : "on the morning"}
            </p>
            <p className="kit-amount">{morningAmount}</p>
            <p className="kit-caption">
              {morning.past
                ? `The balance of ${morningAmount}${plusTax ? ", plus sales tax," : ""} was due on the morning. If you've paid it, ${studioName ?? "your studio"} will mark it paid here.`
                : `The balance of ${morningAmount}${plusTax ? ", plus sales tax," : ""} is due on the morning. You pay ${studioName ?? "your studio"} on the day — there's no invoice to pay before then.`}
            </p>
          </Card>
        ) : nextPlanned ? (
          <Card tone="accent">
            <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
              {nextPlanned.label} · {nextPlanned.dueDate ? `due ${date(nextPlanned.dueDate)}` : "date to come"}
            </p>
            <p className="kit-amount">{money(nextPlanned.amountCents, planCurrency)}</p>
            <p className="kit-caption">
              {`Everything billed so far is paid. ${studioName ?? "Your studio"} sends this invoice about two weeks before it's due.`}
            </p>
          </Card>
        ) : (
          <Card tone="accent">
            <p className="kit-body">Everything billed so far is paid. Thank you.</p>
          </Card>
        )}

        {planRows.length ? (
          <section className="kit-stack-tight" aria-label="Payment plan">
            <h2 className="kit-subsection">
              Your payment plan
              <InfoHint label="Payment plan">
                {`Your ${depositWord}, then each installment, then the final balance. Each invoice is sent about two weeks before it's due.`}
              </InfoHint>
            </h2>
            <List>
              {planRows.map((row, index) => (
                <Row
                  key={`${row.label}-${index}`}
                  subtitle={planRowWhen(row)}
                  title={row.label}
                  trailing={
                    <>
                      {row.state === "paid" ? <Pill tone="accent">Paid</Pill> : null}
                      {row.state === "in_final" ? null : money(row.amountCents, planCurrency)}
                    </>
                  }
                />
              ))}
            </List>
          </section>
        ) : null}

        <section className="kit-stack-tight" aria-label="Payment schedule">
          <h2 className="kit-subsection">
            Schedule
            <InfoHint label="Schedule">
              Every invoice for your booking, soonest first. Pay each from its secure link when it’s due; paid ones
              stay here for your records.
            </InfoHint>
          </h2>
          <List>
            {standing.map((invoice) => (
              <Row
                key={invoice.id}
                onClick={typeof invoice.pdfStoragePath === "string" ? () => void openInvoicePdf(invoice) : undefined}
                subtitle={[
                  // The number on the studio's own invoice, so "which one?" has an answer.
                  text(invoice.number),
                  number(invoice.balanceCents) > 0
                    ? `Due ${date(invoice.dueDate)}`
                    : paidOn(invoice.paidAt)
                      ? `Paid ${date(paidOn(invoice.paidAt))}`
                      : "Paid",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                title={invoiceName(invoice.kind, workspace.tenantTrade, invoice)}
                trailing={
                  <>
                    {invoiceOverdue(invoice) ? (
                      <Pill tone="danger">Overdue</Pill>
                    ) : number(invoice.balanceCents) > 0 ? null : (
                      <Pill tone="accent">{statusLabel(invoice.status)}</Pill>
                    )}
                    {money(invoice.amountCents, invoice.currency)}
                  </>
                }
              />
            ))}
            {morning ? (
              <Row
                subtitle={morning.eventDate ? `Due the morning of ${date(morning.eventDate)}` : "Due on the morning"}
                title="Balance"
                trailing={morningAmount}
              />
            ) : null}
          </List>
          {agreedSalesTax && !agreedSalesTax.exempt && !finalRaised && !morning ? (
            <p className="kit-caption">
              Your final balance comes later, plus sales tax — worked out from your billing address on your final
              invoice.
            </p>
          ) : null}
        </section>

        {/* Card autopay keeps its own design-system form for now: it
            tokenises the card with the payment provider. */}
        <div className="ds-root kit-doc" data-ds-theme="emerald">
          <ClientAutopay />
        </div>

        <Link
          className="kit-caption"
          href="/client/messages?context=Payments"
          style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          <MessageCircle aria-hidden size={15} /> Ask your studio a payment question
        </Link>
        <PoweredBy />
      </Main>

      {due ? (
        <Actions>
          {hostedUrl ? (
            <>
              {openedInvoiceId === due.id ? (
                <Button
                  disabled={invoices.loading}
                  icon={RotateCw}
                  onClick={() => {
                    setNotice("Checking for your latest payment status…");
                    refreshInvoices?.();
                  }}
                  variant="secondary"
                >
                  {invoices.loading ? "Checking…" : "Check payment status"}
                </Button>
              ) : null}
              <a
                className="kit-button"
                href={hostedUrl}
                onClick={() => {
                  setOpenedInvoiceId(due.id);
                  setNotice(null);
                }}
                rel="noreferrer"
                target="_blank"
              >
                Pay {money(due.balanceCents, due.currency)} securely <ExternalLink aria-hidden size={18} />
              </a>
            </>
          ) : payRoute === "direct" ? (
            <Button href="/client/messages?context=Payments" icon={MessageCircle}>
              {`Message ${studioName ?? "your studio"} to arrange payment`}
            </Button>
          ) : (
            <Button icon={RotateCw} onClick={() => refreshInvoices?.()} variant="secondary">
              Refresh status
            </Button>
          )}
        </Actions>
      ) : null}
    </>
  );
}
