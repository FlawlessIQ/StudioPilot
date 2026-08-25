"use client";

import { useState, type FormEvent } from "react";
import { FileCheck2 } from "lucide-react";
import { recordSignedAgreement } from "@/lib/booking/command-client";

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
 * Folded shut, because when a provider is connected this is the unusual
 * path — but always present, because paper happens.
 */
export function RecordSignedAgreement({
  onRecorded,
  projectId,
  proposalId,
}: {
  onRecorded: () => void;
  projectId: string;
  proposalId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      onRecorded();
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "The signature could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="record-signed-agreement">
      <summary>
        <FileCheck2 aria-hidden="true" size={15} />
        Already signed outside StudioCue? Record it
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
        <button className="button" disabled={busy} type="submit">
          {busy ? "Recording…" : "Record the signature"}
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
