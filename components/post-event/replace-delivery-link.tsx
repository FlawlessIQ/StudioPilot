"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * "Wrong link?" on a released delivery (Wave 2).
 *
 * A wrong gallery link could not be taken back: the same link was refused, a
 * new one went out as a second "your photographs are ready", and the wrong
 * `/d/` link stayed live. This revokes the wrong one, releases the right one
 * in its place, and emails the couple once to say so
 * (functions/src/post-event/release.ts `replaceDeliveryLink`).
 *
 * Two steps, because it writes to the couple: fill in the right link, then
 * confirm what will happen. The server decides who may do it.
 */
export function ReplaceDeliveryLink({
  projectId,
  delivery,
  onReplaced,
  defaultOpen = false,
  initialUrl = "",
}: {
  projectId: string;
  delivery: Record<string, unknown> & { id: string };
  onReplaced?: (message: string) => void;
  defaultOpen?: boolean;
  initialUrl?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [url, setUrl] = useState(initialUrl);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // One correction, one key, for as long as it takes to succeed.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const label = text(delivery.label) || "delivery";
  const valid = url.trim().startsWith("https://") && url.trim() !== text(delivery.galleryUrl) && reason.trim().length >= 3;

  async function replace() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPostEventCommand(
        "replaceDeliveryLink",
        {
          projectId,
          deliveryRecordId: delivery.id,
          galleryUrl: url.trim(),
          reason: reason.trim(),
          messageToCouple: note.trim() || null,
        },
        key,
      );
      refreshTenantRecords("deliveryRecords", "projects");
      const message = response.persisted
        ? `Corrected. The old ${label.toLowerCase()} link is taken back and the couple has one email with the right one.`
        : "Development preview: nothing was sent.";
      setNotice(message);
      setConfirming(false);
      setOpen(false);
      setUrl("");
      setReason("");
      setNote("");
      setKey(crypto.randomUUID());
      onReplaced?.(message);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The link could not be replaced."));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <span className="replace-delivery-link">
        <button className="button button-quiet button-sm" onClick={() => setOpen(true)} type="button">
          <Link2 aria-hidden="true" size={14} /> Wrong link?
        </button>
        {notice ? <small role="status">{notice}</small> : null}
      </span>
    );
  }
  return (
    <div className="replace-delivery-link replace-delivery-link-form">
      <label>
        The right link for the {label.toLowerCase()}
        <input onChange={(event) => setUrl(event.target.value)} placeholder="https://…" type="url" value={url} />
      </label>
      <label>
        What was wrong (for your records)
        <input
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Pasted the Chen gallery by mistake"
          value={reason}
        />
      </label>
      <label>
        A line for the couple (optional)
        <textarea maxLength={1200} onChange={(event) => setNote(event.target.value)} rows={2} value={note} />
      </label>
      {confirming ? (
        <p className="form-notice" role="status">
          The old link stops working — it forwards to the new one — and the couple gets one email saying the earlier
          link was wrong, with the right one. Their review asks and the job&rsquo;s delivery are unchanged. Send the
          correction?
        </p>
      ) : null}
      <span>
        {confirming ? (
          <button className="button button-dark" disabled={busy} onClick={() => void replace()} type="button">
            {busy ? "Sending…" : "Yes, send the right link"}
          </button>
        ) : (
          <button className="button" disabled={!valid} onClick={() => setConfirming(true)} type="button">
            Replace the link
          </button>
        )}
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            setOpen(false);
          }}
          type="button"
        >
          Cancel
        </button>
      </span>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
