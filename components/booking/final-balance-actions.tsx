"use client";

import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { RecordFinalPayment } from "@/components/booking/record-final-payment";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { sendFinalBalance } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * The two ways a final balance gets settled, wherever StudioCue says it is due.
 *
 * Today's "send final invoice" step and the job page linked to Invoices, which
 * could not send one: the scheduler raises the final only on the day a wedding
 * is 28 days out, and only when the retainer carries an invoicing customer. So
 * a job booked or moved inside that window, or whose retainer was recorded by
 * hand, was told to bill and given nothing to bill with. Here: send the bill
 * now, or record that it was paid another way.
 */
export function FinalBalanceActions({
  projectId,
  packageSnapshotId,
  balanceLabel,
  onDone,
  buttonClassName = "button button-dark",
  secondaryClassName = "button button-light",
}: {
  projectId: string;
  packageSnapshotId: string | null;
  /** The balance as it stands, for the button and the confirmation. */
  balanceLabel: string | null;
  onDone?: (message: string) => void;
  buttonClassName?: string;
  secondaryClassName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await sendFinalBalance(projectId);
      refreshTenantRecords("invoiceReferences", "providerJobs", "projects");
      const payload = (outcome as { payload?: Record<string, unknown> }).payload ?? {};
      const provider = payload.provider === "stripe" ? "Stripe" : "QuickBooks";
      const message = payload.reviewRequired
        ? "The final bill is drafted but needs a look: the retainer on record doesn't match what was agreed. Open Invoices to check it before it goes."
        : `The final bill${balanceLabel ? ` for ${balanceLabel}` : ""} is being raised in ${provider}; the couple gets it by email.`;
      setNotice(message);
      onDone?.(message);
    } catch (caught) {
      setNotice(friendlyError(caught, "The final bill couldn't be sent."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="final-balance-actions">
      <div className="final-balance-buttons">
        <button className={buttonClassName} disabled={busy} onClick={() => void send()} type="button">
          {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : <Send aria-hidden size={14} />}
          {busy ? "Sending…" : balanceLabel ? `Send the final bill · ${balanceLabel}` : "Send the final bill"}
        </button>
        {packageSnapshotId && !recording ? (
          <button className={secondaryClassName} disabled={busy} onClick={() => setRecording(true)} type="button">
            Paid another way
          </button>
        ) : null}
      </div>
      {recording && packageSnapshotId ? (
        <RecordFinalPayment
          balanceLabel={balanceLabel}
          onRecorded={(message) => {
            setRecording(false);
            setNotice(message);
            refreshTenantRecords("invoiceReferences", "projects", "checkpoints");
            onDone?.(message);
          }}
          packageSnapshotId={packageSnapshotId}
          projectId={projectId}
        />
      ) : null}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
