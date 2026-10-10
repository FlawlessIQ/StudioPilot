"use client";

import { useState } from "react";
import { CircleAlert, LoaderCircle, Mail, PencilLine, RefreshCw, Send } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeVocab } from "@/features/trades/trades";
import { heldInvoiceView } from "@/features/billing/held-invoice-review";
import { friendlyError } from "@/lib/ai/friendly-error";
import { requestBillingAddress, sendHeldInvoice } from "@/lib/booking/command-client";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { VoidInvoice } from "@/components/booking/invoice-corrections";

/**
 * "Check and send": a bill held in QuickBooks for the studio before it goes.
 *
 * QuickBooks works the sales tax out from the couple's billing address; the
 * studio sees what it came to and chooses. Nothing reaches the couple until
 * one of the buttons is pressed:
 *
 *   Send with tax      — QuickBooks' figure, as it stands
 *   Send without tax   — every line made non-taxable in QuickBooks first
 *   Edit               — void this one and send a corrected bill
 *
 * A retainer held for review (billingSettings.holdRetainerForReview) has no
 * tax, so it is only "Send the retainer" or Edit. The server decides and
 * re-checks everything (functions/src/booking/held-invoice-send.ts).
 */

type InvoiceRow = Record<string, unknown> & { id: string };

const OWNER_ADMIN = ["studio_owner", "studio_admin"];

const money = (value: number, currency: unknown) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: typeof currency === "string" && currency ? currency : "USD",
  }).format(value / 100);

export function HeldInvoiceReview({
  invoice,
  onDone,
}: {
  invoice: InvoiceRow;
  onDone?: (message: string) => void;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const view = heldInvoiceView(invoice);
  if (!view) return null;
  const currency = invoice.currency;
  const ownerOrAdmin = OWNER_ADMIN.includes(String(workspace.role));
  const working = view.state !== "awaiting_studio";
  const final = view.kind === "final";

  /**
   * QuickBooks had no address to tax from: email the couple a link to add
   * it. When they do, the tax is worked out again without anyone pressing
   * anything (server/billing/billing-address-request.ts).
   */
  async function askCouple() {
    setBusy("ask");
    setNotice(null);
    try {
      const result = await requestBillingAddress(String(invoice.projectId ?? ""));
      if (result.mode === "preview") {
        setNotice("Development preview: nothing was sent.");
        return;
      }
      refreshTenantRecords("billingAddressRequests", "emailJobs");
      setNotice("Asked. When they add it, QuickBooks works the tax out again and this updates.");
    } catch (caught) {
      setNotice(friendlyError(caught, "The request couldn't be sent."));
    } finally {
      setBusy(null);
    }
  }

  async function act(action: "send_with_tax" | "send_without_tax" | "recalculate") {
    if (!view) return;
    setBusy(action);
    setNotice(null);
    try {
      const result = await sendHeldInvoice({
        projectId: String(invoice.projectId ?? ""),
        invoiceId: invoice.id,
        action,
        confirmAmountCents:
          action === "send_with_tax" ? view.totalCents : action === "send_without_tax" ? view.subtotalCents : null,
      });
      if (result.mode === "preview") {
        setNotice("Development preview: nothing was sent.");
        return;
      }
      const message =
        action === "recalculate"
          ? "QuickBooks is working the tax out again. The figures here update in a moment."
          : action === "send_without_tax"
            ? `Taking the tax off in QuickBooks, then sending ${money(view.subtotalCents, currency)} to the couple.`
            : `Sending ${money(view.totalCents, currency)} to the couple — they get it by email with the pay link.`;
      setNotice(message);
      refreshTenantRecords("invoiceReferences", "providerJobs", "projects", "tasks");
      onDone?.(message);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That didn't go through. Nothing was sent."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="final-balance-actions">
      <div className="invoice-calculation-lines">
        {view.rows.map((row) => (
          <span key={row.key}>
            <small>
              {row.label}
              {row.note ? <em>{row.note}</em> : null}
            </small>
            <strong>{money(row.cents, currency)}</strong>
          </span>
        ))}
      </div>
      {view.note ? (
        <p className="booking-delivery-warning" role="status">
          <CircleAlert aria-hidden="true" size={14} />
          <span>{view.note}</span>
        </p>
      ) : null}
      {view.lastError ? (
        <p className="form-error" role="alert">
          {view.lastError}
        </p>
      ) : null}
      <p>
        {working
          ? view.state === "recalculating"
            ? "QuickBooks is working the tax out again…"
            : "On its way to the couple…"
          : final
            ? "It's in QuickBooks and nothing has gone to the couple yet. Check the tax, then send it."
            : "It's in QuickBooks and nothing has gone to the couple yet. Check it, then send it."}
      </p>
      {ownerOrAdmin && !working ? (
        <div className="final-balance-buttons">
          <button
            className="button button-dark"
            disabled={busy !== null || view.sendWithTaxBlocked}
            onClick={() => void act("send_with_tax")}
            type="button"
          >
            {busy === "send_with_tax" ? (
              <LoaderCircle aria-hidden="true" className="spin" size={14} />
            ) : (
              <Send aria-hidden="true" size={14} />
            )}
            {final
              ? view.taxCents > 0
                ? `Send with tax · ${money(view.totalCents, currency)}`
                : `Send · ${money(view.totalCents, currency)}`
              : `Send the ${tradeVocab(workspace.tenantTrade).deposit} · ${money(view.totalCents, currency)}`}
          </button>
          {view.offerWithoutTax ? (
            <button
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => void act("send_without_tax")}
              type="button"
            >
              {busy === "send_without_tax" ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : null}
              {`Send without tax · ${money(view.subtotalCents, currency)}`}
            </button>
          ) : null}
          {view.billingAddressMissing && final ? (
            <button
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => void askCouple()}
              type="button"
            >
              {busy === "ask" ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : <Mail aria-hidden="true" size={14} />}
              Ask the couple for it
            </button>
          ) : null}
          {view.billingAddressMissing ? (
            <button
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => void act("recalculate")}
              type="button"
            >
              {busy === "recalculate" ? (
                <LoaderCircle aria-hidden="true" className="spin" size={14} />
              ) : (
                <RefreshCw aria-hidden="true" size={14} />
              )}
              Work the tax out again
            </button>
          ) : null}
          <button
            className="button button-secondary"
            disabled={busy !== null}
            onClick={() => setEditing((open) => !open)}
            type="button"
          >
            <PencilLine aria-hidden="true" size={14} />
            Edit
          </button>
        </div>
      ) : null}
      {editing && ownerOrAdmin && !working ? (
        <>
          <p>
            {final
              ? "To change the bill, void this one — here and in QuickBooks — then send a corrected final bill. Check the job's packages, payments and sales tax setting first."
              : `To change the ${tradeVocab(workspace.tenantTrade).deposit}, void this one — here and in QuickBooks — then raise a corrected ${tradeVocab(workspace.tenantTrade).deposit} invoice.`}
          </p>
          <VoidInvoice defaultReason="Correcting the bill before it goes" invoice={invoice} onDone={onDone} />
        </>
      ) : null}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
