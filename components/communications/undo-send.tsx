"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Undo2 } from "lucide-react";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { refreshTenantRecords } from "@/components/live/tenant-records";

/** A send the server is holding for its undo window (functions/src/communications/undo-send.ts). */
export type HeldSend = {
  emailJobId: string;
  /** How long the server holds it, counted from when its answer arrived. */
  windowMs: number;
  /** "your reply to Emma" — what is on its way. */
  label: string;
};

/**
 * The window shown is a little shorter than the server's hold, so an Undo
 * pressed on the last visible second still lands before the email goes. A
 * press that is too late anyway is answered honestly (EMAIL_ALREADY_SENT).
 */
const SHOWN_MARGIN_MS = 1_500;

/** The command's answer, read as a held send if it was one. */
export function heldSendFrom(payload: unknown, label: string): HeldSend | null {
  const value =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const emailJobId = typeof value.emailJobId === "string" ? value.emailJobId : "";
  const windowMs = typeof value.undoWindowMs === "number" ? value.undoWindowMs : 0;
  return emailJobId && windowMs > 0 ? { emailJobId, windowMs, label } : null;
}

/**
 * "Sending your reply to Emma… Undo", for as long as Undo can still work.
 *
 * Calls `onUndone` once the server has called the email back (the draft is
 * back to be sent, edited or put away), and `onGone` when the window closes.
 */
export function UndoSend({
  held,
  onUndone,
  onGone,
  className,
  buttonClassName,
}: {
  held: HeldSend;
  onUndone: () => void;
  onGone: () => void;
  className: string;
  buttonClassName: string;
}) {
  const [state, setState] = useState<"waiting" | "undoing" | "too_late">("waiting");
  const [notice, setNotice] = useState<string | null>(null);
  // Fixed at mount: the parent re-renders (Today refreshes constantly) and a
  // timer restarted on each render would stretch the window past the hold.
  const [shownFor] = useState(() => Math.max(0, held.windowMs - SHOWN_MARGIN_MS));
  const latestOnGone = useRef(onGone);
  useEffect(() => {
    latestOnGone.current = onGone;
  }, [onGone]);

  useEffect(() => {
    if (state !== "waiting") return;
    const timer = window.setTimeout(() => latestOnGone.current(), shownFor);
    return () => window.clearTimeout(timer);
  }, [shownFor, state]);

  async function undo() {
    setState("undoing");
    setNotice(null);
    try {
      await sendCommunicationsCommand({
        type: "cancelQueuedEmail",
        idempotencyKey: crypto.randomUUID(),
        input: { emailJobId: held.emailJobId },
      });
      refreshTenantRecords("aiActions", "communicationDrafts", "emailJobs");
      onUndone();
    } catch (caught: unknown) {
      setState("too_late");
      setNotice(friendlyError(caught, "That couldn't be called back. Check the thread to see if it went."));
      // Long enough to read why, then out of the way.
      window.setTimeout(() => latestOnGone.current(), 4_000);
    }
  }

  return (
    <div className={className} role="status">
      <span>
        {notice ?? (state === "undoing" ? `Calling back ${held.label}…` : `Sending ${held.label}…`)}
      </span>
      {state === "too_late" ? null : (
        <button
          className={buttonClassName}
          disabled={state === "undoing"}
          onClick={() => void undo()}
          type="button"
        >
          {state === "undoing" ? <LoaderCircle className="spin" size={13} /> : <Undo2 size={13} />}
          Undo
        </button>
      )}
    </div>
  );
}
