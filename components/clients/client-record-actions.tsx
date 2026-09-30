"use client";

import { useState } from "react";
import { ArchiveRestore, LoaderCircle, PencilLine } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { ArchiveToggle } from "@/components/records/archive-toggle";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand, teamEmailWarning } from "@/lib/crm/command-client";

/**
 * Correcting and archiving a client.
 *
 * The People page offered a client three controls — message them, pick a
 * project, send a portal invite — and nothing else, ever. A name misspelt at
 * the inquiry form, a new phone number, or an email typed wrong was permanent,
 * and the wrong email means no proposal, no portal and no gallery. There was
 * also an "Archived" filter with no way to put anything in it.
 *
 * Folded shut, because on most rows most days a studio is not editing.
 */
export function ClientRecordActions({
  archived,
  client,
}: {
  archived: boolean;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    notes: string | null;
  };
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const role = useWorkspace().role;

  async function save(values: FormData) {
    setBusy(true);
    setNotice(null);
    try {
      const text = (key: string) => String(values.get(key) ?? "").trim();
      const saved = await runCrmCommand("updateContact", {
        contactId: client.id,
        firstName: text("firstName"),
        lastName: text("lastName"),
        displayName: text("displayName") || null,
        email: text("email") || null,
        phone: text("phone") || null,
        company: text("company") || null,
        notes: text("notes") || null,
      });
      setNotice(teamEmailWarning(saved.result) ?? "Client updated.");
      refreshTenantRecords("contacts");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That client could not be updated."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Editing and archiving a client is an owner/admin decision on the server
   * (crm/commands.ts updateContact, archiveContact). A coordinator was shown
   * both and refused with FORBIDDEN after filling the form in.
   */
  if (role !== "studio_owner" && role !== "studio_admin") return null;

  /**
   * Archived: read-only, with Restore. The edit form used to open here and the
   * server refused the save as "could not be found" about the record on
   * screen. Restoring is the one thing to do, then edit as usual.
   */
  const restore = (
    <ArchiveToggle
      archived={archived}
      kind="client"
      onDone={(message) => {
        setNotice(message);
        refreshTenantRecords("contacts");
      }}
      run={async (restoring) => {
        await runCrmCommand("archiveContact", {
          contactId: client.id,
          restore: restoring,
        });
      }}
    />
  );
  if (archived) {
    return (
      <details className="ds-people-invite record-edit">
        <summary>
          <ArchiveRestore aria-hidden="true" size={14} /> Archived — restore
        </summary>
        <div>
          <p className="record-edit-locked">
            {client.displayName}
            {client.email ? ` · ${client.email}` : ""}
            {client.phone ? ` · ${client.phone}` : ""}. Archived clients can&rsquo;t be edited — restore them first.
          </p>
          {restore}
          {notice ? (
            <p className="form-notice" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      </details>
    );
  }

  return (
    <details className="ds-people-invite record-edit">
      <summary>
        <PencilLine aria-hidden="true" size={14} /> Edit or archive
      </summary>
      <div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(new FormData(event.currentTarget));
          }}
        >
          <label>
            First name
            <input
              defaultValue={client.firstName}
              maxLength={80}
              name="firstName"
              required
            />
          </label>
          <label>
            Last name
            <input
              defaultValue={client.lastName}
              maxLength={80}
              name="lastName"
              required
            />
          </label>
          <label className="record-edit-span">
            Name shown on the job
            <input
              defaultValue={client.displayName}
              maxLength={200}
              name="displayName"
              placeholder="Avery &amp; Sam"
            />
            <small>
              How you refer to them. Couples are usually one contact with both
              names.
            </small>
          </label>
          <label>
            Email
            <input
              defaultValue={client.email ?? ""}
              name="email"
              type="email"
            />
          </label>
          <label>
            Phone
            <input
              defaultValue={client.phone ?? ""}
              maxLength={30}
              name="phone"
            />
          </label>
          <label>
            Company
            <input
              defaultValue={client.company ?? ""}
              maxLength={160}
              name="company"
            />
          </label>
          <label className="record-edit-span">
            Notes
            <textarea
              defaultValue={client.notes ?? ""}
              maxLength={2000}
              name="notes"
              rows={2}
            />
          </label>
          <button className="button" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={14} /> : null}
            Save client
          </button>
        </form>
        {restore}
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </details>
  );
}
