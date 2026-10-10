"use client";

import { useState, type FormEvent } from "react";
import { FileCheck2 } from "lucide-react";
import { recordSignedAgreement } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeVocab } from "@/features/trades/trades";

/**
 * Recording an agreement signed outside StudioCue.
 *
 * A signing provider's API is a paid subscription, and without one a
 * project could not leave CONTRACT_PENDING at all: the send refuses, the
 * journey withholds its manual advance for evidence-controlled steps, and
 * the generic state command throws. Only a provider webhook ever wrote the
 * next state, so a studio that signs by email was stuck at the proposal.
 *
 * The booking gate already accepts an approved exception when a retainer
 * cannot be verified through the provider. This is the same idea for a
 * signature: a named person takes responsibility, the record says who and
 * how, and the gate reports `manual_attestation` rather than implying a
 * provider checked anything.
 *
 * Folded shut when a provider is connected, because then this is the unusual
 * path — but always present, because paper happens. When no signing app is
 * offered at all it is the *only* path, and `primary` opens it: see the note
 * on `signingOffered` in project-booking-workspace.tsx.
 */
export function RecordSignedAgreement({
  onRecorded,
  primary = false,
  projectId,
  proposalId,
  supersedes = false,
}: {
  /** Called with the confirmation to show; the parent owns it, because this
   * control is often unmounted by the reload that follows. */
  onRecorded: (message: string) => void;
  /** Open, and titled as the way this gets done rather than an exception. */
  primary?: boolean;
  projectId: string;
  proposalId: string;
  /** A StudioCue agreement is out with the couple, and recording retires it. */
  supersedes?: boolean;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Recording moves the job on for good and, when an agreement is out, takes
  // it back from the couple. It asks once more, saying so; it used to act on
  // the first tap.
  const [confirming, setConfirming] = useState(false);

  // The server allows owners and admins only (bookingCommand
  // recordSignedAgreement); offering it to a coordinator produced a refusal.
  if (workspace.role !== "studio_owner" && workspace.role !== "studio_admin") {
    return (
      <p className="native-contract-note">
        Signed outside StudioCue? A studio owner or admin records the signature.
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    // Held before the await: React nulls currentTarget once this yields.
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("signedFile");
    setBusy(true);
    setNotice(null);
    try {
      const result = await recordSignedAgreement({
        projectId,
        proposalId,
        signerName: String(data.get("signerName") ?? "").trim(),
        signedAt: String(data.get("signedAt") ?? ""),
        method: String(data.get("method") ?? "").trim(),
        file: file instanceof File && file.size > 0 ? file : null,
      });
      if ("mode" in result && result.mode === "preview") {
        setNotice("Development preview: nothing was recorded.");
        return;
      }
      form.reset();
      setConfirming(false);
      /**
       * Say what happened.
       *
       * This used to reset the form and call `onRecorded()` in silence: the
       * project moved from "Awaiting signature" to "Awaiting the retainer" and
       * the only sign of it was a badge changing somewhere further up the page.
       * Recording a signature by hand is the one step where a photographer is
       * vouching personally, so it is the last place to leave them guessing
       * whether it landed.
       */
      onRecorded(
        supersedes
          ? `Signature recorded against your name. The agreement you sent is retired and the couple is being told there's nothing more to sign. The ${tradeVocab(workspace.tenantTrade).deposit} is the next step.`
          : `Signature recorded against your name. The ${tradeVocab(workspace.tenantTrade).deposit} is the next step.`,
      );
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "The signature could not be recorded."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="record-signed-agreement" open={primary}>
      <summary>
        <FileCheck2 aria-hidden="true" size={15} />
        {primary
          ? "Record the signed agreement"
          : "Already signed outside StudioCue? Record it"}
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          StudioCue records this as your attestation, not a verified signature.
          Keep the signed copy — it is the authority, and the audit log will
          show that you vouched for it.
        </p>
        <label>
          Who signed
          <input
            name="signerName"
            placeholder="John Smith"
            required
            maxLength={160}
          />
        </label>
        <label>
          Date signed
          <input name="signedAt" required type="date" />
        </label>
        <label>
          How it was signed
          <input
            name="method"
            placeholder="Signed PDF returned by email"
            required
            maxLength={200}
          />
        </label>
        <label>
          Signed agreement (optional)
          <input
            accept="application/pdf,image/*"
            name="signedFile"
            type="file"
          />
        </label>
        {confirming ? (
          <div className="form-notice" role="group" aria-label="Confirm the signature">
            <p>
              {`Record it? The job moves on to the ${tradeVocab(workspace.tenantTrade).deposit} now, and this can’t be undone here — it stands as signed on your word.${
                supersedes
                  ? " The agreement you sent them to sign in StudioCue is retired: they can no longer sign it, and they're emailed that there's nothing more to sign."
                  : ""
              }`}
            </p>
            <button className="button button-light" disabled={busy} onClick={() => setConfirming(false)} type="button">
              Not yet
            </button>{" "}
            <button className="button" disabled={busy} type="submit">
              {busy ? "Recording…" : "Record it"}
            </button>
          </div>
        ) : (
          <button className="button" disabled={busy} type="submit">
            Record the signature
          </button>
        )}
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </details>
  );
}
