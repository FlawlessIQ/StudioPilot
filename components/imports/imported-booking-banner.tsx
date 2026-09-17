"use client";

import { useState } from "react";
import { CircleCheck, LoaderCircle, MoonStar } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import { bringImportedBookingLive } from "@/lib/booking/command-client";
import { runClientInvitation } from "@/lib/client/invitation-client";

/**
 * An imported booking, and the decision to bring its couple in.
 *
 * An import arrives quiet: StudioCue holds back every email, invoice, reminder
 * and charge that would reach a couple the studio booked months ago. This is
 * where that ends, and it ends deliberately. The three things it can do are
 * separate choices because they are separate decisions — a studio may want the
 * job on its calendar today and not invite the couple until the schedule is
 * ready — and inviting is off by default, since it is the one that reaches them.
 */
export function ImportedBookingBanner({
  projectId,
  project,
  onChanged,
}: {
  projectId: string;
  project: Record<string, unknown>;
  onChanged?: () => void;
}) {
  const workspace = useWorkspace();
  const [calendarAndFolders, setCalendarAndFolders] = useState(true);
  const [invite, setInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [live, setLive] = useState(false);

  if (typeof project.importedAt !== "string") return null;
  const quiet = typeof project.clientAutomationsPausedAt === "string" && !live;
  if (!quiet && !live) return null;

  const canDecide =
    workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const primaryContactId = Array.isArray(project.clientContactIds)
    ? String(project.clientContactIds[0] ?? "")
    : "";

  async function bringIn() {
    setBusy(true);
    setNotice("");
    try {
      const result = await bringImportedBookingLive({
        projectId,
        calendarAndFolders,
      });
      if (result.mode === "preview") {
        setNotice("Development preview: nothing changed.");
        return;
      }
      let invited = false;
      if (invite && primaryContactId && workspace.tenantId) {
        try {
          await runClientInvitation({
            type: "invite",
            tenantId: workspace.tenantId,
            idempotencyKey: crypto.randomUUID(),
            input: { contactId: primaryContactId, projectId },
          });
          invited = true;
        } catch (caught: unknown) {
          setNotice(
            `They're brought in, but the portal invite didn't send: ${friendlyError(caught, "try again from People.")}`,
          );
        }
      }
      setLive(true);
      if (invited || !invite)
        setNotice(
          [
            "StudioCue can now work with this couple.",
            calendarAndFolders ? "The calendar event and folders are being created." : "",
            invited ? "Their portal invitation is on its way." : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
      onChanged?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The couple couldn't be brought in."));
    } finally {
      setBusy(false);
    }
  }

  if (live)
    return (
      <section className="panel imported-booking-banner is-live" aria-live="polite">
        <CircleCheck size={18} aria-hidden="true" />
        <p>{notice}</p>
      </section>
    );

  return (
    <section className="panel imported-booking-banner">
      <MoonStar size={18} aria-hidden="true" />
      <div>
        <strong>Imported, and quiet</strong>
        <p>
          This booking predates StudioCue. Nothing has been sent to the couple —
          no emails, invoices, reminders or charges — and nothing will be until
          you bring them in.
        </p>
        {canDecide ? (
          <div className="imported-booking-choices">
            <label>
              <input
                checked={calendarAndFolders}
                onChange={(event) => setCalendarAndFolders(event.target.checked)}
                type="checkbox"
              />
              Add it to the calendar and create its folders
            </label>
            <label>
              <input
                checked={invite}
                disabled={!primaryContactId}
                onChange={(event) => setInvite(event.target.checked)}
                type="checkbox"
              />
              Invite the couple to their portal now
            </label>
            <button
              className="button button-dark button-sm"
              disabled={busy}
              onClick={() => void bringIn()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
              Bring this couple into StudioCue
            </button>
          </div>
        ) : (
          <p className="imported-booking-hint">
            A studio owner or admin can bring them in.
          </p>
        )}
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </section>
  );
}
