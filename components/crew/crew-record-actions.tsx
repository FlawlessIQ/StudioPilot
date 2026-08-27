"use client";

import { useState } from "react";
import { LoaderCircle, PencilLine } from "lucide-react";
import { ArchiveToggle } from "@/components/records/archive-toggle";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendCrewCommand } from "@/lib/crew/command-client";

/**
 * The studio's corrections to a directory entry, and removing one.
 *
 * `updateCrewProfile` is strictly self-service — it requires
 * `role === "subcontractor"` and `userId === identity.uid` — so a studio that
 * typed a collaborator into their own directory could never fix a typo in it,
 * and the Crew page had no per-person control at all.
 *
 * Phone and emergency contact are deliberately absent: those belong to the
 * person, who edits them in their own workspace. Name and email are disabled
 * once they have an account, because the email is how they sign in.
 */
export function CrewRecordActions({
  crew,
}: {
  crew: {
    id: string;
    name: string;
    email: string;
    specialties: string[];
    serviceAreas: string[];
    travelRadiusMiles: number;
    rateType: string;
    rateCents: number;
    notes: string | null;
    hasAccount: boolean;
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
      const list = (key: string) =>
        text(key)
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
      await sendCrewCommand("updateCrewDirectoryEntry", {
        crewProfileId: crew.id,
        // Unchanged when they own their identity; the server refuses a change
        // anyway, and sending the current value keeps the form honest.
        name: crew.hasAccount ? crew.name : text("name"),
        email: crew.hasAccount ? crew.email : text("email"),
        specialties: list("specialties"),
        serviceAreas: list("serviceAreas"),
        travelRadiusMiles: Number(text("travelRadiusMiles") || 0),
        rateType: text("rateType") === "hourly" ? "hourly" : "event",
        rateCents: Math.round(Number(text("rate") || 0) * 100),
        notes: text("notes") || null,
      });
      setNotice("Directory entry updated.");
      refreshTenantRecords("crewProfiles");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That entry could not be updated."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="ds-people-invite record-edit">
      <summary>
        <PencilLine aria-hidden="true" size={14} /> Edit or remove
      </summary>
      <div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(new FormData(event.currentTarget));
          }}
        >
          <label>
            Name
            <input
              defaultValue={crew.name}
              disabled={crew.hasAccount}
              maxLength={160}
              name="name"
              required
            />
          </label>
          <label>
            Email
            <input
              defaultValue={crew.email}
              disabled={crew.hasAccount}
              name="email"
              required
              type="email"
            />
          </label>
          {crew.hasAccount ? (
            <p className="record-edit-span record-edit-locked">
              They have their own account, so their name, email, phone and
              emergency contact are theirs to change.
            </p>
          ) : null}
          <label>
            Rate
            <input
              defaultValue={(crew.rateCents / 100).toFixed(2)}
              min="0"
              name="rate"
              step="0.01"
              type="number"
            />
          </label>
          <label>
            Rate type
            <select defaultValue={crew.rateType} name="rateType">
              <option value="event">Per event</option>
              <option value="hourly">Hourly</option>
            </select>
          </label>
          <label>
            Specialties
            <input
              defaultValue={crew.specialties.join(", ")}
              name="specialties"
              placeholder="Second shooter, lighting"
            />
          </label>
          <label>
            Service areas
            <input
              defaultValue={crew.serviceAreas.join(", ")}
              name="serviceAreas"
              placeholder="Hudson Valley, NYC"
            />
          </label>
          <label>
            Travel radius (miles)
            <input
              defaultValue={String(crew.travelRadiusMiles)}
              min="0"
              name="travelRadiusMiles"
              type="number"
            />
          </label>
          <label className="record-edit-span">
            Notes
            <textarea
              defaultValue={crew.notes ?? ""}
              maxLength={2000}
              name="notes"
              rows={2}
            />
          </label>
          <button className="button" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={14} /> : null}
            Save entry
          </button>
        </form>
        <ArchiveToggle
          archived={crew.archived}
          kind="crew"
          onDone={(message) => {
            setNotice(message);
            refreshTenantRecords("crewProfiles");
          }}
          run={async (restore) => {
            await sendCrewCommand("archiveCrewProfile", {
              crewProfileId: crew.id,
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
