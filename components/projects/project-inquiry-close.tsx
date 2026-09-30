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

export function ProjectInquiryClose({
  projectId,
  leadId = null,
  state,
  className = "project-title-action",
}: {
  projectId: string | null;
  /**
   * An inquiry with no job yet is closed and reopened by its lead: the
   * server always could (`closeInquiry`/`reopenInquiry` take a leadId), but
   * the lead page offered neither, so a lost lead stayed open for ever.
   */
  leadId?: string | null;
  state: string;
  className?: string;
}) {
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
        leadId: projectId ? null : leadId,
        ...(type === "closeInquiry" ? { reason } : {}),
      });
      refreshTenantRecords("projects", "leads", "aiActions");
      setOpen(false);
      setError(null);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (closed) {
    return (
      <>
        <button className={className} disabled={busy} onClick={() => void run("reopenInquiry")} type="button">
          {busy ? <LoaderCircle className="spin" size={14} /> : <RotateCcw aria-hidden size={14} />}
          Reopen inquiry
        </button>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <button
        className={className}
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

/**
 * Bring back an inquiry marked "Not an inquiry" (Wave 3).
 *
 * That tap filed the lead away and put its job in ARCHIVED, a state with no
 * way out, so a real couple dismissed by mistake could not be recovered. The
 * sender it may have been told to ignore is un-learned only when the studio
 * ticks the box — the same choice, made the same deliberate way, as the
 * original tap.
 */
export function InquiryRestore({
  leadId,
  sender,
  className = "button button-light",
}: {
  leadId: string;
  sender: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [unignore, setUnignore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await runCrmCommand("restoreInquiry", { leadId, unignoreSender: unignore });
      refreshTenantRecords("projects", "leads");
      setOpen(false);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={className} onClick={() => setOpen(true)} type="button">
        <RotateCcw aria-hidden size={14} /> It is an inquiry — bring it back
      </button>
      <SheetDialog label="Bring this inquiry back" onClose={() => setOpen(false)} open={open}>
        <form
          className="record-sheet"
          onSubmit={(event) => {
            event.preventDefault();
            void restore();
          }}
        >
          <h3>Bring this inquiry back</h3>
          <p>It returns to Inquiries, and so does its job if it had one. Reply drafts dismissed when it was filed away stay dismissed.</p>
          {sender ? (
            <label>
              <input checked={unignore} onChange={(event) => setUnignore(event.target.checked)} type="checkbox" />
              {` Also start capturing mail from ${sender} again, if you told StudioCue to ignore it`}
            </label>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <footer>
            <button className="button button-light" onClick={() => setOpen(false)} type="button">
              Leave it filed away
            </button>
            <button className="button button-dark" disabled={busy} type="submit">
              {busy ? "Bringing it back…" : "Bring it back"}
            </button>
          </footer>
        </form>
      </SheetDialog>
    </>
  );
}
