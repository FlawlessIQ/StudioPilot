"use client";

import { useState } from "react";
import { LoaderCircle, UserPlus } from "lucide-react";
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
 * already.
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

  if (archived) return null;

  async function save(values: FormData) {
    setBusy(true);
    setNotice(null);
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
      setNotice(friendlyError(caught, "That person could not be added."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        aria-expanded={open}
        className="ghost-button"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <UserPlus aria-hidden size={14} /> {open ? "Cancel" : "Add a client"}
      </button>
      {open ? (
        <form
          className="record-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(new FormData(event.currentTarget));
          }}
        >
          <label>
            First name
            <input maxLength={80} name="firstName" required />
          </label>
          <label>
            Last name
            <input maxLength={80} name="lastName" required />
          </label>
          <label>
            Email
            <input name="email" required type="email" />
          </label>
          <label>
            Phone
            <input maxLength={30} name="phone" />
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
            {busy ? "Adding…" : "Add to this job"}
          </button>
        </form>
      ) : null}
      {notice ? (
        <p className="record-edit-notice" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}
