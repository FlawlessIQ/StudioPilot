"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { runCrmCommand } from "@/lib/crm/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * The senders "not an inquiry" taught capture to ignore, each with Remove.
 *
 * Capture drops mail from these without a trace anywhere — no Maybe, no
 * capture record the studio sees — so a wrong one (a studio's own form, from
 * before the server refused to learn those) could only be found by noticing
 * that inquiries had stopped. This is where it is found and undone. Shown in
 * Settings → Inquiry capture, and by Cue (IgnoredSendersCard).
 */
export function IgnoredSenders({
  senders,
  onChanged,
}: {
  senders: readonly string[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function remove(sender: string) {
    setBusy(sender);
    setNotice(null);
    try {
      const response = await runCrmCommand("removeIgnoredSender", { sender });
      setNotice(
        response.persisted
          ? `StudioCue captures mail from ${sender} again.`
          : "Preview: the sender would be removed.",
      );
      onChanged();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That sender couldn't be removed. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ignored-senders">
      <strong>Ignored senders</strong>
      {senders.length ? (
        <>
          <small>
            Mail from these is dropped, because you marked one of their messages &ldquo;not an inquiry&rdquo;.
            Remove one to capture it again.
          </small>
          <ul>
            {senders.map((sender) => (
              <li key={sender}>
                <code>{sender}</code>
                <button
                  className="button button-light button-sm"
                  disabled={busy !== null}
                  onClick={() => void remove(sender)}
                  type="button"
                >
                  {busy === sender ? <LoaderCircle className="spin" size={14} /> : null}
                  {busy === sender ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <small>None. StudioCue ignores a sender only when you ask it to.</small>
      )}
      {notice ? (
        <small className="form-notice" role="status">
          {notice}
        </small>
      ) : null}
    </div>
  );
}
