"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { runProposalCommand } from "@/lib/proposals/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { todayLocalIso } from "@/lib/format/event-date";

/**
 * Recording a client's "yes" on the booking page.
 *
 * The server has accepted `record_acceptance` since couples started saying yes
 * by email and on calls, but the only control for it lived on the proposal
 * screen. The booking page — where "Send contract" lands a studio — showed a
 * contract step with no action and a faint "The client's accepted proposal is
 * required first", with no link to the proposal and no way to say the couple
 * had already agreed. Same command, same attestation, reachable where the wall
 * was.
 */
export function RecordProposalAcceptance({
  onRecorded,
  proposalId,
}: {
  /** The parent owns the confirmation: the reload that follows unmounts this. */
  onRecorded: (message: string) => void;
  proposalId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setNotice(null);
    try {
      const result = await runProposalCommand("record_acceptance", {
        proposalId,
        acceptedBy: String(data.get("acceptedBy") ?? "").trim(),
        acceptedAt: String(data.get("acceptedAt") ?? ""),
        method: String(data.get("method") ?? "").trim(),
        attestation: true,
      });
      if (!result.persisted) {
        setNotice("Development preview: nothing was recorded.");
        return;
      }
      onRecorded(
        "Acceptance recorded against your name. The agreement is the next step.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The acceptance could not be recorded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="record-signed-agreement">
      <summary>
        <CheckCircle2 aria-hidden="true" size={15} />
        They already said yes? Record it
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          StudioCue records this as your attestation, not the client&rsquo;s
          decision. It moves the job on to the agreement, and the audit log
          shows that you vouched for it.
        </p>
        <label>
          Who accepted
          <input maxLength={160} name="acceptedBy" placeholder="Imani Adeyemi" required />
        </label>
        <label>
          Date they accepted
          <input defaultValue={todayLocalIso()} name="acceptedAt" required type="date" />
        </label>
        <label>
          How you heard
          <input maxLength={200} name="method" placeholder="Replied by email" required />
        </label>
        <button className="button" disabled={busy} type="submit">
          {busy ? "Recording…" : "Record the acceptance"}
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
