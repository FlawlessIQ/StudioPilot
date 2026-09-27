"use client";

import { useState } from "react";
import { LoaderCircle, PencilLine } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";

/**
 * Correcting a job.
 *
 * StudioCue was write-once for everything but a client: a job's name, date,
 * venue and type were fixed at creation and there was no control anywhere in
 * the app to change them. The reference studio found the cost of that in an
 * afternoon — a deliberately mistyped client email he could not correct, then a
 * proposal sent four times to an address nobody reads, while the product told
 * him to "open the project details page", which had no such control.
 *
 * Folded shut, like the client equivalent: on most jobs on most days a studio
 * is not editing, and the header is for reading. It opens in a sheet: inline,
 * the form spilled into the title line with each label running into its
 * field (docs/ui-audit-2026-09-27.md).
 */
export function ProjectEdit({
  project,
}: {
  project: {
    id: string;
    name: string;
    eventDate: string;
    eventType: string;
    venueName: string | null;
    city: string | null;
    timezone: string;
    archived: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // An archived job is not editable, and the control should not be there to
  // press — the command refuses it too, but a button that only ever fails is
  // its own small lie.
  if (project.archived) return null;

  async function save(values: FormData) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const text = (key: string) => String(values.get(key) ?? "").trim();
      const nextDate = text("eventDate");
      await runCrmCommand("updateProject", {
        projectId: project.id,
        name: text("name"),
        eventDate: nextDate,
        eventType: text("eventType"),
        venueName: text("venueName") || null,
        city: text("city") || null,
        timezone: text("timezone") || project.timezone,
      });
      setNotice(
        nextDate !== project.eventDate
          ? "Job updated. The date moved, so anything scheduled around it is worth a look."
          : "Job updated.",
      );
      refreshTenantRecords("projects");
      setOpen(false);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That job could not be updated."));
    } finally {
      setBusy(false);
    }
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
        <PencilLine aria-hidden size={14} /> Edit job
      </button>
      <SheetDialog label="Edit job" onClose={() => setOpen(false)} open={open}>
        <form
          className="record-sheet"
          onSubmit={(event) => {
            event.preventDefault();
            void save(new FormData(event.currentTarget));
          }}
        >
          <header>
            <p className="eyebrow">The job</p>
            <h3>Edit job details</h3>
            <p>Changes show everywhere this job appears, including client emails from now on.</p>
          </header>
          <div className="record-sheet-fields">
            <label className="is-wide">
              Job name
              <input defaultValue={project.name} maxLength={200} name="name" required />
            </label>
            <label>
              Event date
              <input
                defaultValue={project.eventDate}
                name="eventDate"
                required
                type="date"
              />
            </label>
            <label>
              Event type
              <input
                defaultValue={project.eventType}
                maxLength={80}
                name="eventType"
                required
              />
            </label>
            <label>
              Venue
              <input defaultValue={project.venueName ?? ""} maxLength={200} name="venueName" />
            </label>
            <label>
              City
              <input defaultValue={project.city ?? ""} maxLength={120} name="city" />
            </label>
            <label className="is-wide">
              <span>
                Time zone <small>the event&apos;s local time, e.g. America/New_York</small>
              </span>
              <input
                defaultValue={project.timezone}
                maxLength={80}
                name="timezone"
                required
              />
            </label>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <footer>
            <button className="button button-light" onClick={() => setOpen(false)} type="button">
              Cancel
            </button>
            <button className="button button-dark" disabled={busy} type="submit">
              {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
              {busy ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </form>
      </SheetDialog>
      {notice ? (
        <p className="project-title-notice" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}
