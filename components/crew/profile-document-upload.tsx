"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, UploadCloud } from "lucide-react";
import { friendlyError } from "@/lib/ai/friendly-error";
import { uploadCrewProfileDocument } from "@/lib/crew/command-client";

/**
 * Sending a W-9 or a certificate of insurance that belongs to the person.
 *
 * Uploads were assignment-scoped, so these two had no route at all until a job
 * existed — a crew profile listed both as "missing" and offered nothing to do
 * about it, and a studio already holding a W-9 by email could not file it.
 *
 * The same control serves both, because the file and the rule are the same
 * whoever sends it. What differs is only the sentence around it, which the
 * caller supplies.
 */
const labels = { w9: "W-9", insurance: "Certificate of insurance" } as const;

export function CrewProfileDocumentUpload({
  crewProfileId,
  kind,
  status,
  onUploaded,
}: {
  crewProfileId: string;
  kind: "w9" | "insurance";
  status: string;
  onUploaded?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // "received" and "verified" both mean a file is already on hand; only the
  // second means somebody has looked at it, and that is the studio's to say.
  const onFile = ["received", "verified"].includes(status) || done;

  async function send(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      await uploadCrewProfileDocument({ crewProfileId, kind, file });
      setDone(true);
      setNotice("Sent. The studio will confirm it once they've checked it.");
      onUploaded?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That file could not be uploaded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="crew-profile-document">
      <label aria-busy={busy} className={onFile ? "is-submitted" : ""}>
        {busy ? (
          <LoaderCircle className="spin" size={20} />
        ) : onFile ? (
          <CheckCircle2 size={20} />
        ) : (
          <UploadCloud size={20} />
        )}
        <span>
          <strong>
            {busy
              ? "Uploading securely…"
              : onFile
                ? `${labels[kind]} on file`
                : `Send your ${labels[kind]}`}
          </strong>
          <small>
            {onFile
              ? "Upload again to replace it."
              : "PDF, JPEG or PNG · 25 MB maximum"}
          </small>
        </span>
        <input
          accept=".pdf,.jpg,.jpeg,.png"
          disabled={busy}
          onChange={(event) => void send(event.target.files?.[0])}
          type="file"
        />
      </label>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
