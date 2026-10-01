"use client";

import { useState, type FormEvent } from "react";
import { Ban, Banknote, LoaderCircle, PencilLine, Send } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  invoiceAtProvider,
  invoiceVoidRefusal,
  paidOnInvoice,
  paymentCorrectable,
} from "@/features/booking/invoice-corrections";
import { dollarsToCents, invoicePaymentRefusal } from "@/features/booking/invoice-payments";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  approveFinalInvoice,
  correctPaymentRecord,
  recordInvoicePayment,
  voidInvoice,
} from "@/lib/booking/command-client";
import { refreshTenantRecords } from "@/components/live/tenant-records";

/**
 * Taking back a bill, and correcting a payment (money audit, wave 1).
 *
 * The controls behind "void it first" and "that payment was wrong", which
 * StudioCue told studios to use for months without having either. Each is
 * folded shut and asks for a reason, because each is a correction that stays
 * on the record with the studio's name on it. The server decides everything
 * that matters — whether a bill can be voided, what a corrected payment makes
 * of it, what a final bill comes to (functions/src/booking/invoice-corrections.ts);
 * these only carry the request, and hide themselves when it would be refused.
 */

type InvoiceRow = Record<string, unknown> & { id: string };

const OWNER_ADMIN = ["studio_owner", "studio_admin"];

function money(cents: unknown, currency: unknown): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: typeof currency === "string" && currency ? currency : "USD",
  }).format(Number(cents ?? 0) / 100);
}

function providerLabel(provider: unknown): string {
  return provider === "stripe" ? "Stripe" : provider === "quickbooks" ? "QuickBooks" : "your invoicing app";
}

const kindLabel = (invoice: InvoiceRow) => (invoice.kind === "final" ? "final balance" : "retainer");

function refreshMoney() {
  refreshTenantRecords("invoiceReferences", "projects", "tasks", "checkpoints", "readinessAssessments");
}

/** "Void this invoice", on an unpaid bill. */
export function VoidInvoice({
  invoice,
  onDone,
  defaultReason = "",
}: {
  invoice: InvoiceRow;
  onDone?: (message: string) => void;
  /** The operator's own words, when Cue brought them here. */
  defaultReason?: string;
}) {
  const workspace = useWorkspace();
  const [reason, setReason] = useState(defaultReason);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!OWNER_ADMIN.includes(String(workspace.role))) return null;
  if (invoiceVoidRefusal(invoice) !== null) return null;
  const atProvider = invoiceAtProvider(invoice);
  const provider = providerLabel(invoice.provider);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Two presses: the first says exactly what will happen.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await voidInvoice({
        projectId: String(invoice.projectId ?? ""),
        invoiceId: invoice.id,
        reason: reason.trim(),
      });
      if (result.mode === "preview") {
        setNotice("Development preview: nothing was voided.");
        return;
      }
      const message =
        result.payload.providerVoid === "queued"
          ? `Voided. ${provider} is voiding it too — if it can't, you'll get a task to void it there yourself.`
          : "Voided. The couple can no longer pay it.";
      setNotice(message);
      refreshMoney();
      onDone?.(message);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The invoice couldn't be voided."));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <details className="record-signed-agreement">
      <summary>
        <Ban aria-hidden="true" size={15} />
        Void this invoice
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          {`Voids the ${money(invoice.amountCents, invoice.currency)} ${kindLabel(invoice)} invoice${
            atProvider ? ` here and in ${provider}` : ""
          }, so the couple can no longer pay it. It stays on the record with your reason. `}
          {invoice.kind === "final"
            ? "You can send a new final bill afterwards."
            : "You can raise a new retainer invoice afterwards."}
        </p>
        <label>
          Why
          <textarea
            maxLength={500}
            minLength={3}
            onChange={(event) => {
              setReason(event.target.value);
              setConfirming(false);
            }}
            placeholder="Wrong amount — raising a corrected one."
            required
            rows={2}
            value={reason}
          />
        </label>
        <button className="button" disabled={busy || reason.trim().length < 3} type="submit">
          {busy ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : null}
          {confirming ? "Yes, void it" : "Void this invoice"}
        </button>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </details>
  );
}

/**
 * "Record a payment", on a retainer or final bill out with the couple: all of
 * the balance or part of it. On a QuickBooks or Stripe bill the payment is
 * recorded there too, so the couple's link and autopay ask only for the rest
 * (functions/src/booking/invoice-payments.ts).
 */
export function RecordInvoicePayment({
  invoice,
  onDone,
}: {
  invoice: InvoiceRow;
  onDone?: (message: string) => void;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!OWNER_ADMIN.includes(String(workspace.role))) return null;
  if (invoicePaymentRefusal(invoice) !== null) return null;
  const atProvider = invoiceAtProvider(invoice);
  const provider = providerLabel(invoice.provider);
  const balance = Number(invoice.balanceCents ?? 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Held before the await: React nulls currentTarget once this yields.
    const form = event.currentTarget;
    const data = new FormData(form);
    const amountCents = dollarsToCents(String(data.get("amount") ?? ""));
    if (amountCents === null || amountCents <= 0) {
      setNotice(friendlyError(new Error("PAYMENT_AMOUNT_INVALID"), "Check the amount."));
      return;
    }
    if (amountCents > balance) {
      setNotice(friendlyError(new Error("PAYMENT_EXCEEDS_BALANCE"), "Check the amount."));
      return;
    }
    const reference = String(data.get("reference") ?? "").trim();
    setBusy(true);
    setNotice(null);
    try {
      const result = await recordInvoicePayment({
        projectId: String(invoice.projectId ?? ""),
        invoiceId: invoice.id,
        amountCents,
        paidAt: String(data.get("paidAt") ?? ""),
        method: String(data.get("method") ?? "").trim(),
        reference: reference || null,
      });
      if (result.mode === "preview") {
        setNotice("Development preview: nothing was recorded.");
        return;
      }
      const left = Number(result.payload.balanceCents ?? 0);
      const there =
        result.payload.providerSync === "queued"
          ? ` ${provider} is being updated too — if it can't take it, you'll get a task to record it there yourself.`
          : "";
      const message =
        left > 0
          ? `Recorded ${money(amountCents, invoice.currency)}; ${money(left, invoice.currency)} is still owed.${there}`
          : `Recorded. The ${kindLabel(invoice)} is paid.${there}`;
      form.reset();
      setNotice(message);
      refreshMoney();
      onDone?.(message);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The payment couldn't be recorded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="record-signed-agreement">
      <summary>
        <Banknote aria-hidden="true" size={15} />
        Record a payment
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          {`${money(balance, invoice.currency)} is left on this ${kindLabel(invoice)} invoice. Enter what arrived — all of it or part. It's recorded against your name${
            atProvider ? ` and in ${provider} too, so the couple's link asks only for the rest` : ""
          }.`}
        </p>
        {/* Stripe can't take a part payment made outside it; it is recorded
            there as a credit note, and the studio should know what they'll
            see. See features/booking/invoice-payments.ts. */}
        {atProvider && invoice.provider === "stripe" ? (
          <p className="record-attestation-caveat">
            In Stripe a part payment shows as a credit note marked &ldquo;Paid outside Stripe&rdquo;; paying the
            rest marks the invoice paid outside Stripe.
          </p>
        ) : null}
        <label>
          Amount received
          <input defaultValue={(balance / 100).toFixed(2)} inputMode="decimal" name="amount" required />
        </label>
        <label>
          Date received
          <input name="paidAt" required type="date" />
        </label>
        <label>
          How it arrived
          <input maxLength={200} name="method" placeholder="Bank transfer" required />
        </label>
        <label>
          Reference (optional)
          <input maxLength={200} name="reference" placeholder="Payment or cheque reference" />
        </label>
        <button className="button" disabled={busy} type="submit">
          {busy ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : null}
          {busy ? "Recording…" : "Record the payment"}
        </button>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </details>
  );
}

/** "Correct this payment", on a payment the studio recorded. */
export function CorrectPayment({
  invoice,
  onDone,
}: {
  invoice: InvoiceRow;
  onDone?: (message: string) => void;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!OWNER_ADMIN.includes(String(workspace.role))) return null;
  if (!paymentCorrectable(invoice)) return null;
  const atProvider = invoiceAtProvider(invoice);
  const current = (invoice.currentPayment ?? invoice.completionEvidence ?? {}) as Record<string, unknown>;
  const paidCents = paidOnInvoice(invoice);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Held before the await: React nulls currentTarget once this yields.
    const form = event.currentTarget;
    const data = new FormData(form);
    const amountCents = dollarsToCents(String(data.get("amount") ?? ""));
    if (amountCents === null) {
      setNotice(friendlyError(new Error("PAYMENT_AMOUNT_INVALID"), "Check the amount."));
      return;
    }
    const reference = String(data.get("reference") ?? "").trim();
    setBusy(true);
    setNotice(null);
    try {
      const result = await correctPaymentRecord({
        projectId: String(invoice.projectId ?? ""),
        invoiceId: invoice.id,
        amountCents,
        paidAt: String(data.get("paidAt") ?? ""),
        method: String(data.get("method") ?? "").trim(),
        reference: reference || null,
        reason: String(data.get("reason") ?? "").trim(),
      });
      if (result.mode === "preview") {
        setNotice("Development preview: nothing was changed.");
        return;
      }
      const status = String(result.payload.status ?? "");
      const message =
        status === "paid"
          ? "Payment corrected. The earlier record stays in the history."
          : status === "partially_paid"
            ? `Payment corrected to ${money(amountCents, invoice.currency)}; the rest is still owed.`
            : "Payment withdrawn. Nothing is recorded as paid on this invoice now.";
      setNotice(message);
      refreshMoney();
      onDone?.(message);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The payment couldn't be corrected."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="record-signed-agreement">
      <summary>
        <PencilLine aria-hidden="true" size={15} />
        Correct this payment
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          {`Recorded as ${money(paidCents, invoice.currency)} paid. Enter what actually arrived — 0 if nothing did. `}
          The correction is added to the record; the original entry stays in the history.
        </p>
        {atProvider ? (
          <p className="form-notice">
            {`This invoice is in ${providerLabel(invoice.provider)}, which never saw this payment, so it can be corrected to the full amount or to nothing. If only part arrived, correct it to nothing, then use Record a payment for what did — that records it in ${providerLabel(invoice.provider)} too.`}
          </p>
        ) : null}
        <label>
          Amount received
          <input
            defaultValue={(paidCents / 100).toFixed(2)}
            inputMode="decimal"
            name="amount"
            required
          />
        </label>
        <label>
          Date received
          <input
            defaultValue={String(current.paidAt ?? invoice.paidAt ?? "").slice(0, 10)}
            name="paidAt"
            required
            type="date"
          />
        </label>
        <label>
          How it arrived
          <input defaultValue={String(current.method ?? "")} maxLength={200} name="method" required />
        </label>
        <label>
          Reference (optional)
          <input defaultValue={String(current.reference ?? "")} maxLength={200} name="reference" />
        </label>
        <label>
          Why
          <input maxLength={500} minLength={3} name="reason" placeholder="Recorded on the wrong day" required />
        </label>
        <button className="button" disabled={busy} type="submit">
          {busy ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : null}
          {busy ? "Correcting…" : "Save the correction"}
        </button>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </details>
  );
}

/**
 * A final bill held for review, sent once the studio has looked.
 *
 * `amountCents` is the balance as the screens work it out now
 * (features/booking/final-balance-due.ts); the server works it out again and
 * refuses if they differ, so this confirms a figure rather than setting one.
 */
export function ApproveFinalInvoice({
  invoice,
  amountCents,
  onDone,
}: {
  invoice: InvoiceRow;
  amountCents: number | null;
  onDone?: (message: string) => void;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!OWNER_ADMIN.includes(String(workspace.role))) return null;
  if (invoice.kind !== "final" || invoice.status !== "review_required") return null;
  const provider = providerLabel(invoice.provider);

  async function send() {
    if (!amountCents) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await approveFinalInvoice({
        projectId: String(invoice.projectId ?? ""),
        invoiceId: invoice.id,
        confirmAmountCents: amountCents,
      });
      if (result.mode === "preview") {
        setNotice("Development preview: nothing was sent.");
        return;
      }
      const message = `The final bill for ${money(amountCents, invoice.currency)} is going to ${provider}; the couple gets it by email.`;
      setNotice(message);
      refreshTenantRecords("invoiceReferences", "providerJobs", "projects");
      onDone?.(message);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The final bill couldn't be sent."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="final-balance-actions">
      <p>
        {amountCents
          ? `Worked out again from what they agreed, less everything paid so far: ${money(amountCents, invoice.currency)}. Check it, then send it through ${provider}.`
          : "Nothing is left to pay on this job, so there is no bill to send. Void this one."}
      </p>
      <div className="final-balance-buttons">
        <button
          className="button button-dark"
          disabled={busy || !amountCents}
          onClick={() => void send()}
          type="button"
        >
          {busy ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : <Send aria-hidden="true" size={14} />}
          {amountCents ? `Send the final bill · ${money(amountCents, invoice.currency)}` : "Send the final bill"}
        </button>
      </div>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/** Both corrections, for an invoice row on Invoices. */
export function InvoiceRecordActions({ invoice }: { invoice: InvoiceRow }) {
  const workspace = useWorkspace();
  // A final bill held for review is sent from its card further down this
  // page (FinalInvoiceReconciliation), which works out the amount again. The
  // row only offered Void, so the send was easy to miss (prod walk, 2026-09-30).
  const checkAndSend =
    invoice.kind === "final" &&
    invoice.status === "review_required" &&
    OWNER_ADMIN.includes(String(workspace.role));
  return (
    <>
      {checkAndSend ? (
        <a className="button button-dark" href={`#final-invoice-${invoice.id}`}>
          <Send aria-hidden="true" size={14} /> Check and send
        </a>
      ) : null}
      <RecordInvoicePayment invoice={invoice} />
      <VoidInvoice invoice={invoice} />
      <CorrectPayment invoice={invoice} />
    </>
  );
}
