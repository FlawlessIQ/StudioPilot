"use client";

import { useState } from "react";
import { Archive, LoaderCircle, RotateCcw } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { lostReasonLabel } from "@/features/inquiries/pipeline";
import { preBookingStates } from "@/features/inquiries/stages";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";

/**
 * Close an inquiry that didn't book, with the reason — or reopen one.
 *
 * Distinct from "Not an inquiry", which is for spam and teaches capture to
 * ignore the sender; closing a real couple teaches nothing and reopens by
 * itself if they write again. Shown only while the job is still an inquiry,
 * or once it has been closed.
 */
const reasons = ["went_quiet", "booked_elsewhere", "budget", "date_taken", "not_a_fit", "other"] as const;
type Reason = (typeof reasons)[number];

export function ProjectInquiryClose({ projectId, state }: { projectId: string; state: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("went_quiet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = state === "LOST";
  if (!closed && !preBookingStates.has(state)) return null;

  async function run(type: "closeInquiry" | "reopenInquiry") {
    setBusy(true);
    setError(null);
    try {
      await runCrmCommand(type, {
        projectId,
        leadId: null,
        ...(type === "closeInquiry" ? { reason } : {}),
      });
      refreshTenantRecords("projects", "leads", "aiActions");
      setOpen(false);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (closed) {
    return (
      <button className="project-title-action" disabled={busy} onClick={() => void run("reopenInquiry")} type="button">
        {busy ? <LoaderCircle className="spin" size={14} /> : <RotateCcw aria-hidden size={14} />}
        Reopen inquiry
      </button>
    );
  }

  return (
    <>
      <button
        className="project-title-action"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        type="button"
      >
        <Archive aria-hidden size={14} /> Close inquiry
      </button>
      <SheetDialog label="Close this inquiry" onClose={() => setOpen(false)} open={open}>
        <form
          className="record-sheet"
          onSubmit={(event) => {
            event.preventDefault();
            void run("closeInquiry");
          }}
        >
          <h3>Close this inquiry</h3>
          <p>It moves to Closed on Inquiries. If they write again, it reopens by itself.</p>
          <fieldset className="inquiry-close-reasons">
            <legend>Why didn&apos;t it book?</legend>
            {reasons.map((value) => (
              <label key={value}>
                <input checked={reason === value} name="close-reason" onChange={() => setReason(value)} type="radio" />
                {lostReasonLabel[value]}
              </label>
            ))}
          </fieldset>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <footer>
            <button className="button button-light" onClick={() => setOpen(false)} type="button">
              Keep it open
            </button>
            <button className="button button-dark" disabled={busy} type="submit">
              {busy ? "Closing…" : "Close inquiry"}
            </button>
          </footer>
        </form>
      </SheetDialog>
    </>
  );
}
