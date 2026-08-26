"use client";

import { useState, type FormEvent } from "react";
import { Banknote } from "lucide-react";
import { recordRetainerPayment } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Recording a retainer that arrived outside StudioCue.
 *
 * The mirror of RecordSignedAgreement, one step later and for the same
 * dead end. Without an invoicing provider StudioCue refuses to raise a
 * retainer — correctly, rather than invoice through an account nobody
 * connected — which left the booking gate permanently short of both a
 * created retainer and a paid one. A studio taking bank transfers could
 * not confirm a booking at all.
 *
 * No amount field. The retainer is whatever the accepted package snapshot
 * says it is, read server-side, so recording a payment cannot quietly
 * restate the price. A studio that took a different figure has taken a
 * part payment, which is not this — the approved retainer exception is the
 * path for going ahead without the full amount, and it says so in the
 * record.
 *
 * Folded shut, because with a provider connected this is the unusual path.
 */
export function RecordRetainerPayment({
  onRecorded,
  packageSnapshotId,
  projectId,
  retainerLabel,
}: {
  onRecorded: () => void;
  packageSnapshotId: string;
  projectId: string;
  /** The retainer as the couple was quoted it, for the confirmation line. */
  retainerLabel: string;
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
      const result = await recordRetainerPayment({
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
      onRecorded();
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "The payment could not be recorded."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="record-signed-agreement">
      <summary>
        <Banknote aria-hidden="true" size={15} />
        Retainer paid outside StudioCue? Record it
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          StudioCue records this as your attestation, not a confirmed payment.
          It books the job on your word, and the audit log will show that you
          vouched for it. Records {retainerLabel} — the retainer on the package
          the couple accepted.
        </p>
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
