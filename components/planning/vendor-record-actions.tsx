"use client";

import { useState } from "react";
import { LoaderCircle, PencilLine } from "lucide-react";
import { ArchiveToggle } from "@/components/records/archive-toggle";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";

/**
 * Correcting and archiving a vendor or venue.
 *
 * `vendors` is `allow write: if false` in the rules and had only a create
 * command, so the Vendors page offered exactly one control — "Add vendor" — and
 * nothing else, ever. A venue that changes its contact, or a company name typed
 * wrong, was permanent; and those venue details are what the COI request sends
 * to the venue's own insurer.
 */
export function VendorRecordActions({
  vendor,
}: {
  vendor: {
    id: string;
    company: string;
    contactName: string;
    email: string | null;
    phone: string | null;
    type: string;
    website: string | null;
    notes: string | null;
    archived: boolean;
  };
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(values: FormData) {
    setBusy(true);
    setNotice(null);
    try {
      const text = (key: string) => String(values.get(key) ?? "").trim();
      await sendPlanningCommand("updateVendor", {
        vendorId: vendor.id,
        company: text("company"),
        contactName: text("contactName"),
        email: text("email") || null,
        phone: text("phone") || null,
        type: text("type"),
        website: text("website") || null,
        notes: text("notes") || null,
      });
      setNotice("Vendor updated.");
      refreshTenantRecords("vendors");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That vendor could not be updated."));
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
            Company or venue
            <input
              defaultValue={vendor.company}
              maxLength={200}
              name="company"
              required
            />
          </label>
          <label>
            Type
            <input
              defaultValue={vendor.type}
              maxLength={80}
              name="type"
              placeholder="Venue, planner, florist"
              required
            />
          </label>
          <label>
            Contact name
            <input
              defaultValue={vendor.contactName}
              maxLength={160}
              name="contactName"
            />
          </label>
          <label>
            Email
            <input
              defaultValue={vendor.email ?? ""}
              name="email"
              type="email"
            />
          </label>
          <label>
            Phone
            <input
              defaultValue={vendor.phone ?? ""}
              maxLength={40}
              name="phone"
            />
          </label>
          <label>
            Website
            <input
              defaultValue={vendor.website ?? ""}
              name="website"
              placeholder="https://"
              type="url"
            />
          </label>
          <label className="record-edit-span">
            Notes
            <textarea
              defaultValue={vendor.notes ?? ""}
              maxLength={2000}
              name="notes"
              rows={2}
            />
          </label>
          <button className="button" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={14} /> : null}
            Save vendor
          </button>
        </form>
        <ArchiveToggle
          archived={vendor.archived}
          kind="vendor"
          onDone={(message) => {
            setNotice(message);
            refreshTenantRecords("vendors");
          }}
          run={async (restore) => {
            await sendPlanningCommand("archiveVendor", {
              vendorId: vendor.id,
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
