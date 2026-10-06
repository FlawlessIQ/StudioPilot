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
export type ClientBillingAddress = {
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
};

/** A stored billing address, or null — read off a contact record. */
export function billingAddressOf(value: unknown): ClientBillingAddress | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const str = (key: string) => (typeof record[key] === "string" ? String(record[key]).trim() : "");
  if (!str("line1") || !str("city")) return null;
  return {
    line1: str("line1"),
    line2: str("line2") || null,
    city: str("city"),
    region: str("region") || null,
    postalCode: str("postalCode") || null,
    country: str("country") || "US",
  };
}

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
    /**
     * Where they are billed. Undefined when the caller doesn't know (the form
     * then only sends an address someone typed); null when there is none.
     */
    billingAddress?: ClientBillingAddress | null;
    /** The couple confirmed or typed the address when they signed. */
    billingAddressByCouple?: boolean;
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
      // QuickBooks taxes from this address, so half of one is no use: a
      // street and a city, or nothing.
      const address = {
        line1: text("billingLine1"),
        line2: text("billingLine2") || null,
        city: text("billingCity"),
        region: text("billingRegion") || null,
        postalCode: text("billingPostalCode") || null,
        country: (text("billingCountry") || "US").toUpperCase(),
      };
      const typed = [address.line1, address.line2, address.city, address.region, address.postalCode].some(Boolean);
      if (typed && (!address.line1 || !address.city)) {
        setNotice("Add the street and city for the billing address, or clear it.");
        return;
      }
      const saved = await runCrmCommand("updateContact", {
        contactId: client.id,
        firstName: text("firstName"),
        lastName: text("lastName"),
        displayName: text("displayName") || null,
        email: text("email") || null,
        phone: text("phone") || null,
        company: text("company") || null,
        notes: text("notes") || null,
        // Left out entirely when nobody typed one and none was known, so a
        // caller that doesn't load addresses can't clear one by omission.
        billingAddress: typed ? address : client.billingAddress === undefined ? undefined : null,
      });
      setNotice(teamEmailWarning(saved.result) ?? emailFollowedNotice(saved.result) ?? "Client updated.");
      refreshTenantRecords("contacts");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That client could not be updated."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * What moved with a new email (functions/src/crm/email-change.ts), said
   * once, so the studio knows the next resend and signature use it.
   */
  function emailFollowedNotice(result: unknown): string | null {
    const followed = (result as { emailFollowed?: { contracts?: unknown[]; amendments?: unknown[] } } | null)
      ?.emailFollowed;
    if (!followed) return null;
    const waiting = (followed.contracts?.length ?? 0) + (followed.amendments?.length ?? 0);
    return waiting
      ? `Client updated. Proposals, follow-ups and the ${waiting === 1 ? "agreement waiting on them" : "agreements waiting on them"} now go to the new address.`
      : "Client updated. Proposals and follow-ups now go to the new address.";
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
            Billing address
            <input
              autoComplete="street-address"
              defaultValue={client.billingAddress?.line1 ?? ""}
              maxLength={200}
              name="billingLine1"
              placeholder="Street"
            />
            <small>
              {client.billingAddressByCouple && client.billingAddress
                ? "Confirmed by the couple at signing. Changing it here makes it yours. "
                : ""}
              QuickBooks works out sales tax from this. Filled in on their
              QuickBooks customer if it has none.
            </small>
          </label>
          <label>
            Apt, suite
            <input
              defaultValue={client.billingAddress?.line2 ?? ""}
              maxLength={200}
              name="billingLine2"
            />
          </label>
          <label>
            City
            <input
              autoComplete="address-level2"
              defaultValue={client.billingAddress?.city ?? ""}
              maxLength={120}
              name="billingCity"
            />
          </label>
          <label>
            State
            <input
              autoComplete="address-level1"
              defaultValue={client.billingAddress?.region ?? ""}
              maxLength={80}
              name="billingRegion"
            />
          </label>
          <label>
            ZIP code
            <input
              autoComplete="postal-code"
              defaultValue={client.billingAddress?.postalCode ?? ""}
              maxLength={20}
              name="billingPostalCode"
            />
          </label>
          <label>
            Country
            <input
              autoComplete="country"
              defaultValue={client.billingAddress?.country ?? "US"}
              maxLength={2}
              minLength={2}
              name="billingCountry"
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
