"use client";

import { useState, type FormEvent } from "react";
import { Banknote } from "lucide-react";
import { recordFinalPayment } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Recording a final balance that arrived outside StudioCue.
 *
 * The mirror of RecordRetainerPayment, one payment later and for a dead end
 * that was worse. The final invoice is created by a scheduler 28 days before
 * the event, so a couple who settled up early — or by transfer, or in cash —
 * left the job on the last closeout requirement, "Final QuickBooks balance
 * settled", with nothing anywhere in the product able to satisfy it. The job
 * could be delivered, reviewed and finished, and never closed.
 *
 * No amount field, for the same reason as the retainer: the balance is read
 * server-side from the accepted proposal's payment schedule, so recording a
 * payment cannot quietly restate the price.
 */
export function RecordFinalPayment({
  onRecorded,
  packageSnapshotId,
  projectId,
  balanceLabel,
  providerLabel,
  standingInvoice,
}: {
  /** Called with the confirmation to show; the parent owns it, because this
   * control is often unmounted by the reload that follows. */
  onRecorded: (message: string) => void;
  packageSnapshotId: string;
  projectId: string;
  /** The balance as the couple was quoted it, for the confirmation line. */
  balanceLabel?: string | null;
  /** The provider hosting the invoice, when one is out with the couple. */
  providerLabel?: string | null;
  /** True when an invoice already stands and this settles it. */
  standingInvoice?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Held before the await: React nulls currentTarget once this yields.
    const form = event.currentTarget;
    const data = new FormData(form);
    const reference = String(data.get("reference") ?? "").trim();
    setBusy(true);
    setNotice(null);
    try {
      const result = await recordFinalPayment({
        projectId,
        packageSnapshotId,
        paidAt: String(data.get("paidAt") ?? ""),
        method: String(data.get("method") ?? "").trim(),
        reference: reference.length > 0 ? reference : null,
      });
      if ("mode" in result && result.mode === "preview") {
        setNotice("Development preview: nothing was recorded.");
        return;
      }
      form.reset();
      onRecorded(
        "Balance recorded against your name. Reconcile the closeout to finish.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The payment could not be recorded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="record-signed-agreement">
      <summary>
        <Banknote aria-hidden="true" size={15} />
        Balance paid outside StudioCue? Record it
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          StudioCue records this as your attestation, not a confirmed payment.
          It closes the job on your word, and the audit log will show that you
          vouched for it.
          {balanceLabel
            ? ` Records ${balanceLabel} — the balance on the package the couple accepted.`
            : " The amount comes from the proposal they accepted."}
        </p>
        {standingInvoice ? (
          <p className="record-attestation-caveat">
            This marks the balance invoice already out with the couple as paid,
            rather than raising a second one. It does not mark it paid in{" "}
            {providerLabel ?? "your accounting tool"} — do that there too, so the
            two agree.
          </p>
        ) : null}
        <label>
          Date received
          <input name="paidAt" required type="date" />
        </label>
        <label>
          How it arrived
          <input
            maxLength={200}
            name="method"
            placeholder="Bank transfer"
            required
          />
        </label>
        <label>
          Reference (optional)
          <input
            maxLength={200}
            name="reference"
            placeholder="Payment or cheque reference"
          />
        </label>
        <button className="button" disabled={busy} type="submit">
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
