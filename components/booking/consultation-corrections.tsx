"use client";

import { useState } from "react";
import { LoaderCircle, RotateCcw, UserX } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { useZoomConnected } from "@/components/integrations/use-capability";
import { defaultConsultationMode } from "@/features/consultations/meeting-mode";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { runPublicScheduling } from "@/lib/booking/public-scheduling-client";

/**
 * Correcting a consultation after the fact (wave 3).
 *
 * A couple who didn't turn up had no status — `no_show` was in the schema and
 * nothing wrote it — and a consultation marked held by mistake could not be
 * put back, because cancel and reschedule both require it still to be booked.
 * This offers, for one consultation:
 *   - booked and started: "They didn't show", which leaves the job where it is
 *   - missed: "Invite them to rebook" (the same scheduling link the job page
 *     sends a lead) and "Reopen"
 *   - held: "Reopen", back to booked if it is still to come, otherwise back to
 *     waiting for its notes
 * The server decides each (functions/src/booking/consultation-undo.ts).
 */
export function ConsultationCorrections({
  consultation,
  projectId,
  projectState,
  contactId,
  onChanged,
  compact = false,
}: {
  consultation: { id: string; status?: unknown; startsAt?: unknown };
  projectId: string;
  projectState: string;
  contactId: string | null;
  onChanged?: () => void;
  /** The calendar's small buttons, rather than the booking page's. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const zoomConnected = useZoomConnected();
  // "Now" fixed per mount, so a render stays pure.
  const [openedAt] = useState(() => Date.now());
  const status = String(consultation.status ?? "");
  const started = Date.parse(String(consultation.startsAt ?? "")) <= openedAt;
  const beforeProposal = projectState === "LEAD" || projectState === "CONSULTATION";

  async function command(type: "markConsultationNoShow" | "reopenConsultation", done: string) {
    setBusy(type);
    setNotice(null);
    try {
      const outcome = await sendBookingCommand({
        type,
        idempotencyKey: crypto.randomUUID(),
        input: { projectId, consultationId: consultation.id },
      });
      setNotice(outcome.mode === "preview" ? "Development preview: validated but not persisted." : done);
      refreshTenantRecords("consultations", "projects");
      onChanged?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That change could not be made."));
    } finally {
      setBusy(null);
    }
  }

  async function invite() {
    if (!contactId) return;
    setBusy("invite");
    setNotice(null);
    try {
      await runPublicScheduling({
        type: "create_link",
        idempotencyKey: crypto.randomUUID(),
        input: { projectId, contactId, mode: defaultConsultationMode(zoomConnected) },
      });
      setNotice("They're being emailed a link to pick another time.");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The invitation could not be sent."));
    } finally {
      setBusy(null);
    }
  }

  const buttonClass = compact ? "ds-cal-slot-btn" : "button button-quiet";
  const spin = (key: string) => (busy === key ? <LoaderCircle className="spin" size={13} /> : null);
  const buttons = [];
  if (status === "scheduled" && started && beforeProposal) {
    buttons.push(
      <button
        className={buttonClass}
        disabled={busy !== null}
        key="no-show"
        onClick={() =>
          void command(
            "markConsultationNoShow",
            "Marked as missed. The job stays where it is — invite them to pick another time when you're ready.",
          )
        }
        type="button"
      >
        {spin("markConsultationNoShow") ?? <UserX aria-hidden="true" size={13} />}{" "}
        They didn&rsquo;t show
      </button>,
    );
  }
  if (status === "no_show" && contactId && beforeProposal) {
    buttons.push(
      <button className={buttonClass} disabled={busy !== null} key="invite" onClick={() => void invite()} type="button">
        {spin("invite")}{" "}
        Invite them to rebook
      </button>,
    );
  }
  if ((status === "completed" || status === "no_show") && beforeProposal) {
    buttons.push(
      <button
        className={buttonClass}
        disabled={busy !== null}
        key="reopen"
        onClick={() =>
          void command(
            "reopenConsultation",
            started
              ? "Reopened. It's waiting for your notes again."
              : "Reopened. It's back on as booked.",
          )
        }
        type="button"
      >
        {spin("reopenConsultation") ?? <RotateCcw aria-hidden="true" size={13} />}{" "}
        Reopen
      </button>,
    );
  }
  if (!buttons.length && !notice) return null;
  return (
    <span className={compact ? "ds-cal-consult-actions" : "consultation-corrections"}>
      {buttons}
      {notice ? <small className={compact ? "ds-cal-consult-note" : "form-notice"} role="status">{notice}</small> : null}
    </span>
  );
}
