"use client";

import { useState, type FormEvent } from "react";
import { Banknote } from "lucide-react";
import { recordFinalPayment } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeVocab } from "@/features/trades/trades";
import { todayLocalIso } from "@/lib/format/event-date";

/**
 * How a balance taken on the morning arrives, one button each. What a
 * makeup artist or hair stylist is handed in the chair; anything else, or
 * another day, goes through the form below them.
 */
const ON_THE_DAY_METHODS: ReadonlyArray<{ method: string; label: string }> = [
  { method: "Card", label: "Card" },
  { method: "Cash", label: "Cash" },
  { method: "Venmo or Zelle", label: "Venmo or Zelle" },
  { method: "Check", label: "Check" },
];

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
  defaultOpen = false,
  singleBill = false,
  onTheDay = false,
}: {
  /**
   * The balance is collected on the morning (a makeup artist or hair
   * stylist: features/billing/balance-on-the-day.ts). One tap records it,
   * dated today, at the agreed amount; the full form stays underneath.
   */
  onTheDay?: boolean;
  /** The job's one bill (paid on the day, or invoiced after — job-kinds.ts), not a balance after a retainer. */
  singleBill?: boolean;
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
  /** Open, for a surface that already asked "paid another way?". */
  defaultOpen?: boolean;
}) {
  // A makeup artist or hair stylist's client accepted a quote (trades.ts).
  const offer = tradeVocab(useWorkspace().tenantTrade).proposal.toLowerCase();
  const [busy, setBusy] = useState(false);
  /** Which one-tap method is recording, so only that button says so. */
  const [tapped, setTapped] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** True once recorded; false when it was refused or only previewed. */
  async function record(input: { paidAt: string; method: string; reference: string | null }): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      const result = await recordFinalPayment({ projectId, packageSnapshotId, ...input });
      if ("mode" in result && result.mode === "preview") {
        setNotice("Development preview: nothing was recorded.");
        return false;
      }
      onRecorded(
        onTheDay && input.paidAt === todayLocalIso()
          ? `Balance${balanceLabel ? ` of ${balanceLabel}` : ""} recorded as paid today.`
          : "Balance recorded against your name. Reconcile the closeout to finish.",
      );
      return true;
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The payment could not be recorded."));
      return false;
    } finally {
      setBusy(false);
      setTapped(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Held before the await: React nulls currentTarget once this yields.
    const form = event.currentTarget;
    const data = new FormData(form);
    const reference = String(data.get("reference") ?? "").trim();
    const recorded = await record({
      paidAt: String(data.get("paidAt") ?? ""),
      method: String(data.get("method") ?? "").trim(),
      reference: reference.length > 0 ? reference : null,
    });
    if (recorded) form.reset();
  }

  if (onTheDay) {
    return (
      <div className="final-balance-actions">
        <p>
          {`Took the balance${balanceLabel ? ` of ${balanceLabel}` : ""} this morning? Tap how they paid.`}{" "}
          It&apos;s recorded for today, on your word, at the amount they agreed.
        </p>
        <div className="final-balance-buttons">
          {ON_THE_DAY_METHODS.map((option) => (
            <button
              className="button button-dark"
              disabled={busy}
              key={option.method}
              onClick={() => {
                setTapped(option.method);
                void record({ paidAt: todayLocalIso(), method: option.method, reference: null });
              }}
              type="button"
            >
              {tapped === option.method ? "Recording…" : option.label}
            </button>
          ))}
        </div>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        <details className="record-signed-agreement">
          <summary>
            <Banknote aria-hidden="true" size={15} />
            Another day, or another way?
          </summary>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              Date received
              <input defaultValue={todayLocalIso()} name="paidAt" required type="date" />
            </label>
            <label>
              How it arrived
              <input maxLength={200} name="method" placeholder="Bank transfer" required />
            </label>
            <label>
              Reference (optional)
              <input maxLength={200} name="reference" placeholder="Payment or check reference" />
            </label>
            <button className="button" disabled={busy} type="submit">
              {busy && !tapped ? "Recording…" : "Record the payment"}
            </button>
          </form>
        </details>
      </div>
    );
  }

  return (
    <details className="record-signed-agreement" open={defaultOpen}>
      <summary>
        <Banknote aria-hidden="true" size={15} />
        {singleBill ? "Paid outside StudioCue? Record it" : "Balance paid outside StudioCue? Record it"}
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          StudioCue records this as your attestation, not a confirmed payment.{" "}
          {singleBill
            ? "It settles the bill on your word, and the audit log will show that you vouched for it."
            : "It closes the job on your word, and the audit log will show that you vouched for it."}
          {" "}{balanceLabel
            ? ` Records ${balanceLabel} — the ${singleBill ? "bill" : "balance"} on what the client accepted.`
            : ` The amount comes from the ${offer} they accepted.`}
        </p>
        {standingInvoice ? (
          <p className="record-attestation-caveat">
            {`This marks the ${singleBill ? "invoice" : "balance invoice"} already out with the client as paid,`}{" "}
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
            placeholder="Payment or check reference"
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
