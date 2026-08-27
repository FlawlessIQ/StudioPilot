"use client";

import { useState } from "react";
import { LoaderCircle, PencilLine } from "lucide-react";
import { ArchiveToggle } from "@/components/records/archive-toggle";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";

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

  async function save(values: FormData) {
    setBusy(true);
    setNotice(null);
    try {
      const text = (key: string) => String(values.get(key) ?? "").trim();
      await runCrmCommand("updateContact", {
        contactId: client.id,
        firstName: text("firstName"),
        lastName: text("lastName"),
        displayName: text("displayName") || null,
        email: text("email") || null,
        phone: text("phone") || null,
        company: text("company") || null,
        notes: text("notes") || null,
      });
      setNotice("Client updated.");
      refreshTenantRecords("contacts");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That client could not be updated."));
    } finally {
      setBusy(false);
    }
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
        <ArchiveToggle
          archived={archived}
          kind="client"
          onDone={(message) => {
            setNotice(message);
            refreshTenantRecords("contacts");
          }}
          run={async (restore) => {
            await runCrmCommand("archiveContact", {
              contactId: client.id,
              restore,
            });
          }}
        />
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </details>
  );
}
