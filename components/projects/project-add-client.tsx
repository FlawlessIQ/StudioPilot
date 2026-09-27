"use client";

import { useState } from "react";
import { LoaderCircle, UserPlus } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";

/**
 * The second person on the job.
 *
 * A wedding is two people, and a project has always carried
 * `clientContactIds` as an array — but nothing could append to it after the
 * job was created, and every email took the first contact and ignored the
 * rest. So the partner heard nothing: not the proposal, not the questionnaire,
 * not the gallery. "A lot of the time they both want to be on emails. Believe
 * it or not this age group the men care about this shit!"
 *
 * Folded shut like the other job controls, because most jobs have their people
 * already, and opened in a sheet rather than inline beside the job's title.
 */
export function ProjectAddClient({
  projectId,
  archived,
}: {
  projectId: string;
  archived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (archived) return null;

  async function save(values: FormData) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const text = (key: string) => String(values.get(key) ?? "").trim();
      const result = await runCrmCommand("addProjectClient", {
        projectId,
        firstName: text("firstName"),
        lastName: text("lastName"),
        email: text("email"),
        phone: text("phone") || null,
      });
      setNotice(
        (result.result as { created?: boolean } | undefined)?.created === false
          ? "Added. They were already in your contacts, so the existing record is linked."
          : "Added. They will be on this job's emails from now on.",
      );
      refreshTenantRecords("projects", "contacts");
      setOpen(false);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That person could not be added."));
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
        <UserPlus aria-hidden size={14} /> Add a client
      </button>
      <SheetDialog label="Add a client" onClose={() => setOpen(false)} open={open}>
        <form
          className="record-sheet"
          onSubmit={(event) => {
            event.preventDefault();
            void save(new FormData(event.currentTarget));
          }}
        >
          <header>
            <p className="eyebrow">The job</p>
            <h3>Add a client to this job</h3>
            <p>Usually the partner. They&apos;ll get this job&apos;s client emails from now on.</p>
          </header>
          <div className="record-sheet-fields">
            <label>
              First name
              <input autoComplete="off" maxLength={80} name="firstName" required />
            </label>
            <label>
              Last name
              <input autoComplete="off" maxLength={80} name="lastName" required />
            </label>
            <label>
              Email
              <input autoComplete="off" name="email" required type="email" />
            </label>
            <label>
              <span>
                Phone <small>optional</small>
              </span>
              <input autoComplete="off" maxLength={30} name="phone" type="tel" />
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
              {busy ? "Adding…" : "Add to this job"}
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
