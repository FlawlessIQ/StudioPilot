"use client";

import { useState } from "react";
import { LoaderCircle, PencilLine } from "lucide-react";
import { ArchiveToggle } from "@/components/records/archive-toggle";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { CrewProfileDocumentUpload } from "@/components/crew/profile-document-upload";
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
    inviteStatus: string;
    w9Status: string;
    insuranceStatus: string;
    contractStatus: string;
    hasAccount: boolean;
    archived: boolean;
  };
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function invite() {
    setBusy(true);
    setNotice(null);
    try {
      await sendCrewCommand("inviteCrewProfile", { crewProfileId: crew.id });
      setNotice("Invitation sent. The link expires in seven days.");
      refreshTenantRecords("crewProfiles");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That invitation could not be sent."));
    } finally {
      setBusy(false);
    }
  }

  async function saveCompliance(values: FormData) {
    setBusy(true);
    setNotice(null);
    try {
      await sendCrewCommand("setCrewCompliance", {
        crewProfileId: crew.id,
        w9Status: String(values.get("w9Status") ?? "missing"),
        insuranceStatus: String(values.get("insuranceStatus") ?? "missing"),
        contractStatus: String(values.get("contractStatus") ?? "missing"),
      });
      setNotice("Paperwork updated.");
      refreshTenantRecords("crewProfiles");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That paperwork could not be updated."));
    } finally {
      setBusy(false);
    }
  }

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
        {/*
          Anyone added before roster invites existed has no account and no
          token, so this is the only way they ever get one.
        */}
        {crew.hasAccount ? null : (
          <div className="record-edit-invite">
            <p className="record-edit-locked">
              {crew.inviteStatus === "invited"
                ? "Invited. They haven't set up their account yet."
                : "No invitation sent yet — they can't add their own availability or documents until they have one."}
            </p>
            <button
              className="button button-light button-sm"
              disabled={busy}
              onClick={() => void invite()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" size={14} /> : null}
              {crew.inviteStatus === "invited" ? "Resend invite" : "Send invite"}
            </button>
          </div>
        )}
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
        {/*
          Separate from the entry form on purpose. Everything above is a
          description of the person; this is a record of what the studio holds
          on file for them, and until it is set the cascade will not put them
          forward for any job.
        */}
        <form
          className="record-edit-compliance"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCompliance(new FormData(event.currentTarget));
          }}
        >
          <p className="record-edit-span record-edit-locked">
            Paperwork you hold for them. A W-9 that is received, insurance
            verified and the agreement completed clears their profile gaps and
            ranks them higher when you fill a role.
          </p>
          {/*
            A studio is usually emailed a W-9 long before the person ever signs
            in, so it can file one here rather than wait for them to. Uploading
            moves the status to "received" — never past it. Whether it has
            actually been checked is the studio saying so, in the selects
            below, which is the whole point of them.
          */}
          <div className="record-edit-span record-edit-documents">
            <CrewProfileDocumentUpload
              crewProfileId={crew.id}
              kind="w9"
              onUploaded={() => refreshTenantRecords("crewProfiles")}
              status={crew.w9Status}
            />
            <CrewProfileDocumentUpload
              crewProfileId={crew.id}
              kind="insurance"
              onUploaded={() => refreshTenantRecords("crewProfiles")}
              status={crew.insuranceStatus}
            />
          </div>
          <label>
            W-9
            <select defaultValue={crew.w9Status} name="w9Status">
              <option value="missing">Missing</option>
              <option value="requested">Requested</option>
              <option value="received">Received</option>
              <option value="verified">Verified</option>
            </select>
          </label>
          <label>
            Insurance
            <select defaultValue={crew.insuranceStatus} name="insuranceStatus">
              <option value="missing">Missing</option>
              <option value="requested">Requested</option>
              <option value="received">Received</option>
              <option value="verified">Verified</option>
              <option value="expired">Expired</option>
            </select>
          </label>
          <label>
            Crew agreement
            <select defaultValue={crew.contractStatus} name="contractStatus">
              <option value="missing">Missing</option>
              <option value="sent">Sent</option>
              <option value="completed">Completed</option>
              <option value="expired">Expired</option>
            </select>
          </label>
          <button className="button" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={14} /> : null}
            Save paperwork
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
