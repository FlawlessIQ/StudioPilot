"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, LockKeyhole, MessageCircle, RotateCw } from "lucide-react";
import { Actions, Button, Card, List, Main, Pill, PoweredBy, Row, Steps } from "@/components/kit/kit";
import { ClientAutopay } from "@/components/client/client-autopay";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import { statusLabel } from "@/features/format/status-label";
import {
  date,
  invoiceOverdue,
  money,
  number,
  text,
  useProjectRecords,
  useReserveYourDate,
} from "@/components/client/live-client-views";
import { EmptyMoment } from "@/components/client/kit/empty-moment";

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
  const invoices = useProjectRecords("invoiceReferences");
  const reserve = useReserveYourDate();
  const [openedInvoiceId, setOpenedInvoiceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshInvoices = invoices.refresh;

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
  const hostedUrl = due && typeof due.hostedUrl === "string" && due.hostedUrl ? due.hostedUrl : null;
  const provider = due ? (text(due.provider) === "stripe" ? "Stripe" : "QuickBooks") : null;

  if (invoices.error || standing.length === 0)
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
          <h1 className="kit-title">{due ? "Your next payment" : "All paid"}</h1>
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
            {hostedUrl ? (
              <p className="kit-caption">
                <LockKeyhole aria-hidden size={14} /> Secure payment opens in {provider}. StudioCue never receives
                your card or bank details.
              </p>
            ) : (
              <p className="kit-caption">
                Secure payment link is still syncing. Refresh in a moment, or message your studio if you need to pay
                now.
              </p>
            )}
            {notice ? (
              <p className="kit-caption" role="status">
                {notice}
              </p>
            ) : null}
          </Card>
        ) : (
          <Card tone="accent">
            <p className="kit-body">Everything billed so far is paid. Thank you.</p>
          </Card>
        )}

        <section className="kit-stack-tight" aria-label="Payment schedule">
          <h2 className="kit-subsection">Schedule</h2>
          <List>
            {standing.map((invoice) => (
              <Row
                key={invoice.id}
                subtitle={
                  number(invoice.balanceCents) > 0
                    ? `Due ${date(invoice.dueDate)}`
                    : `Paid · ${date(invoice.dueDate)}`
                }
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
          </List>
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
