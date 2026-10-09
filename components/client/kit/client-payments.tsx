"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileText, LockKeyhole, MessageCircle, RotateCw } from "lucide-react";
import { resolveFile } from "@/lib/documents/resolve-file";
import { Actions, Button, Card, List, Main, Pill, PoweredBy, Row, Steps } from "@/components/kit/kit";
import { ClientAutopay } from "@/components/client/client-autopay";
import { useWorkspace } from "@/features/auth/workspace-context";
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

/** "retainer" and "final" are the system's words, not a couple's. */
function invoiceName(kind: unknown): string {
  const value = text(kind, "");
  if (value === "retainer") return "Retainer";
  if (value === "final") return "Final balance";
  return value ? value.replace(/^\w/, (c) => c.toUpperCase()) : "Invoice";
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
          invoiceName: invoiceName(due.kind),
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
          <h1 className="kit-title">{due || morning ? "Your next payment" : "All paid"}</h1>
        </div>

        {due ? (
          <Card tone="accent">
            <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
              {invoiceName(due.kind)} · {invoiceOverdue(due) ? "overdue" : `due ${date(due.dueDate)}`}
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
        ) : (
          <Card tone="accent">
            <p className="kit-body">Everything billed so far is paid. Thank you.</p>
          </Card>
        )}

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
                  number(invoice.balanceCents) > 0 ? `Due ${date(invoice.dueDate)}` : `Paid · ${date(invoice.dueDate)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                title={invoiceName(invoice.kind)}
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
