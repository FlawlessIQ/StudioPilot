"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, LoaderCircle, Paperclip } from "lucide-react";
import { attachSignedCopyToImportedBooking } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Filing the signed contract for a booking that arrived from somewhere else.
 *
 * A studio adopting StudioCue imports a year of weddings it already signed.
 * `attachImportedSignedCopy` — the command, the storage path and the rules —
 * has always existed, but it was reachable only *during* an import, from the
 * single-booking form's optional file field. A bulk import carries no PDFs, so
 * every one of those jobs landed with `signedDocumentId: null` and no way on
 * earth to fill it.
 *
 * The reference studio imported his whole book and then asked "where do I
 * upload the pdf contract?" — there was no answer. This is it.
 *
 * Deliberately not `recordSignedAgreement`: that one drives the live booking
 * gate and refuses anything that is not CONTRACT_PENDING with an accepted
 * proposal. Nothing is being decided here. The job is already booked and the
 * agreement already exists as `completionAuthority: "imported"` evidence; this
 * only puts the paper where the couple's record can point at it.
 */
export function AttachSignedCopy({
  onAttached,
  projectId,
}: {
  onAttached: (message: string) => void;
  projectId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Held before the await: React nulls currentTarget once this yields.
    const form = event.currentTarget;
    const file = new FormData(form).get("signedCopy");
    if (!(file instanceof File) || file.size === 0) {
      setNotice("Choose the signed agreement to attach.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await attachSignedCopyToImportedBooking({
        projectId,
        signedCopy: file,
      });
      if (result.mode === "preview") {
        setNotice("Development preview: nothing was attached.");
        return;
      }
      form.reset();
      onAttached(
        "Signed agreement filed against this job. The couple can see it in their portal.",
      );
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "The signed agreement could not be attached."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="record-signed-agreement">
      <summary>
        <Paperclip aria-hidden="true" size={15} />
        Have the signed contract? Attach it
      </summary>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          This job was booked before StudioCue, so its agreement is already on
          file as your own attestation. Attaching the PDF puts the paper with
          the record — it changes nothing about the booking.
        </p>
        <label>
          Signed agreement
          <input accept="application/pdf,image/*" name="signedCopy" required type="file" />
        </label>
        {notice ? (
          <p className="form-error" role="alert">
            {notice}
          </p>
        ) : null}
        <button className="button button-dark" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
          Attach signed agreement
        </button>
      </form>
    </details>
  );
}
