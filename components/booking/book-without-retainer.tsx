"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendBookingCommand } from "@/lib/booking/command-client";

/**
 * Confirming a booking without its retainer.
 *
 * Some bookings are made without one — a returning couple, a friend, a job
 * paid in full later. The booking gate always allowed for that as an approved
 * exception, and nothing could approve one, so those bookings could not be
 * confirmed. This records the decision with the reason, then runs the gate
 * with it.
 *
 * Folded shut and worded as a waiver, not a shortcut: it is the owner going on
 * record that the money hasn't arrived, and the audit trail says so.
 */
export function BookWithoutRetainer({
  projectId,
  projectVersion,
  onBooked,
}: {
  projectId: string;
  projectVersion: number;
  onBooked: (message: string) => void;
}) {
  const workspace = useWorkspace();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (workspace.role !== "studio_owner" && workspace.role !== "studio_admin")
    return null;

  async function confirm() {
    setBusy(true);
    setNotice("");
    try {
      const approved = await sendBookingCommand({
        type: "approveRetainerException",
        idempotencyKey: crypto.randomUUID(),
        input: { projectId, reason: reason.trim() },
      });
      if (approved.mode === "preview") {
        setNotice("Development preview: nothing was recorded.");
        return;
      }
      const exceptionId = String(approved.payload.exceptionId ?? "");
      const gate = await sendBookingCommand({
        type: "runBookingGate",
        idempotencyKey: crypto.randomUUID(),
        input: {
          projectId,
          expectedProjectVersion: projectVersion,
          approvedRetainerExceptionId: exceptionId,
        },
      });
      const payload = gate.mode === "live" ? gate.payload : {};
      if (payload.passed === true) {
        onBooked("Booked without the retainer, recorded against your name.");
        return;
      }
      const blockers = Array.isArray(payload.blockers)
        ? payload.blockers.filter((item): item is string => typeof item === "string")
        : [];
      setNotice(
        blockers.length
          ? `The retainer is waived, but the booking is still waiting on: ${blockers.join(", ")}.`
          : "The retainer is waived, but the booking couldn't be confirmed yet.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The booking couldn't be confirmed without the retainer."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="record-signed-agreement book-without-retainer">
      <summary>Booking without a retainer? Waive it</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <p>
          For a booking you&rsquo;re confirming without taking a retainer. The
          booking goes ahead now, and the record says the retainer was waived,
          by you, and why.
        </p>
        <label>
          Why
          <textarea
            maxLength={500}
            minLength={10}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Returning couple — paying in full a month before."
            required
            rows={2}
            value={reason}
          />
        </label>
        <button className="button" disabled={busy || reason.trim().length < 10} type="submit">
          {busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
          Confirm the booking without a retainer
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
