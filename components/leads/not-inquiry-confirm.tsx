"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { runCrmCommand } from "@/lib/crm/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * The confirm step for "Not an inquiry".
 *
 * It used to file the message away *and* teach capture to drop its sender for
 * good, on one tap, without saying which address that was. When that address
 * was the studio's own website form, every later inquiry vanished and nothing
 * on any screen said so. Now the step names the sender and offers two
 * answers: just this one (nothing learned — the safe default, so it comes
 * first), or this one and everything from that sender. The server still
 * refuses to learn a form, marketplace or studio address
 * (functions/src/intake/ignorable-sender.ts), and says why; that is shown
 * here before the item goes. Settings → Inquiry capture lists what has been
 * learned, with Remove.
 */
export function NotInquiryConfirm({
  leadId,
  sender,
  onDone,
  onCancel,
  primaryClass,
  secondaryClass,
  className = "not-inquiry-confirm",
}: {
  leadId: string;
  /** The address it could ignore (features/intake/not-inquiry.ts), or null. */
  sender: string | null;
  onDone: () => void;
  onCancel: () => void;
  primaryClass: string;
  secondaryClass: string;
  className?: string;
}) {
  const [busy, setBusy] = useState<"one" | "sender" | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function remove(ignoreSender: boolean) {
    setBusy(ignoreSender ? "sender" : "one");
    setNotice(null);
    try {
      const response = await runCrmCommand("markLeadNotInquiry", { leadId, ignoreSender });
      if (!response.persisted) {
        setNotice("Preview: your answer would be saved.");
        return;
      }
      const refused = response.result.senderKept as { message?: unknown } | null | undefined;
      if (ignoreSender && refused && typeof refused.message === "string") {
        setKept(`Removed. StudioCue will keep capturing ${sender ?? "that sender"}: ${refused.message}`);
        return;
      }
      onDone();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That couldn't be removed. Try again."));
    } finally {
      setBusy(null);
    }
  }

  if (kept) {
    return (
      <div className={className} role="status">
        <span>{kept}</span>
        <button className={primaryClass} onClick={onDone} type="button">
          OK
        </button>
      </div>
    );
  }

  return (
    <div className={className} role="group" aria-label="Not an inquiry">
      <span>
        {sender
          ? `Remove it? You can also have StudioCue ignore everything from ${sender} from now on.`
          : "Remove it? Only this message goes — StudioCue keeps capturing its sender."}
      </span>
      <button className={primaryClass} disabled={busy !== null} onClick={() => void remove(false)} type="button">
        {busy === "one" ? <LoaderCircle className="spin" size={14} /> : null}
        {busy === "one" ? "Removing…" : sender ? "Just this one — don't ignore the sender" : "Yes, remove it"}
      </button>
      {sender ? (
        <button className={secondaryClass} disabled={busy !== null} onClick={() => void remove(true)} type="button">
          {busy === "sender" ? <LoaderCircle className="spin" size={14} /> : null}
          {busy === "sender" ? "Removing…" : `Remove and ignore ${sender}`}
        </button>
      ) : null}
      <button className={secondaryClass} disabled={busy !== null} onClick={onCancel} type="button">
        Keep it
      </button>
      {notice ? (
        <small className="form-notice" role="status">
          {notice}
        </small>
      ) : null}
    </div>
  );
}
