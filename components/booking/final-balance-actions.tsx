"use client";

import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { RecordFinalPayment } from "@/components/booking/record-final-payment";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { useWorkspace } from "@/features/auth/workspace-context";
import { jobClientRecipient, recipientLabel } from "@/features/projects/client-recipient";
import { sendFinalBalance } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { finalBillWords } from "@/features/billing/final-bill-words";
import { useFinalBillCheckedFirst } from "@/components/booking/use-final-bill-checked-first";
import { useJobBilling } from "@/components/booking/use-job-billing";

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
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const { records: contacts } = useTenantDocuments("contacts");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The bill is emailed to the couple the moment it's raised, and it went on
   * one tap (wave 3). The step names the amount and who gets it.
   */
  const [confirming, setConfirming] = useState(false);
  const checkedFirst = useFinalBillCheckedFirst();
  // A job the studio bills itself (features/billing/job-billing.ts) has no
  // bill to send from here: the server refuses it (BILLING_STUDIO_JOB), so
  // recording the payment is the one action, and it leads.
  const studioBilled = useJobBilling(projectId)?.method === "studio";
  const recipient = recipientLabel(
    jobClientRecipient(
      projects?.find((project) => project.id === projectId),
      contacts,
    ),
  );
  const words = finalBillWords({ checkedFirst, amount: balanceLabel, recipient });
  // sendFinalBalance and recordFinalPayment are owner/admin on the server
  // (BALANCE_ATTESTATION_PERMISSION_REQUIRED): don't offer what it refuses.
  const mayBill = workspace.role === "studio_owner" || workspace.role === "studio_admin";

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
        : provider === "QuickBooks" && checkedFirst
          ? words.done
          : `The final bill${balanceLabel ? ` for ${balanceLabel}` : ""} is being raised in ${provider}; the couple gets it by email.`;
      setNotice(message);
      onDone?.(message);
    } catch (caught) {
      setNotice(friendlyError(caught, "The final bill couldn't be sent."));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!mayBill) {
    return (
      <p className="form-notice" role="status">
        {studioBilled
          ? "An owner or admin records the payment when it comes in."
          : "An owner or admin sends the final bill, or records it as paid another way."}
      </p>
    );
  }

  return (
    <div className="final-balance-actions">
      {confirming ? (
        <ConfirmStep
          busy={busy}
          cancelClassName={secondaryClassName}
          cancelLabel="Not now"
          confirmClassName={buttonClassName}
          confirmLabel={words.confirmLabel}
          label="Send the final bill?"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void send()}
        >
          {words.body}
        </ConfirmStep>
      ) : null}
      <div className="final-balance-buttons">
        {confirming || studioBilled ? null : (
          <button className={buttonClassName} disabled={busy} onClick={() => setConfirming(true)} type="button">
            {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : <Send aria-hidden size={14} />}
            {busy ? "Sending…" : balanceLabel ? `Send the final bill · ${balanceLabel}` : "Send the final bill"}
          </button>
        )}
        {packageSnapshotId && !recording && !confirming ? (
          <button
            className={studioBilled ? buttonClassName : secondaryClassName}
            disabled={busy}
            onClick={() => setRecording(true)}
            type="button"
          >
            {studioBilled ? (balanceLabel ? `Record the payment · ${balanceLabel}` : "Record the payment") : "Paid another way"}
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
          defaultOpen
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
