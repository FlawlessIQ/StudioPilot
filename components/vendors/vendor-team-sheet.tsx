"use client";

import { useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import type { TeamRecord } from "@/components/vendors/use-vendor-team";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import {
  VENDOR_TEAM_CATEGORIES,
  VENDOR_TEAM_STATUS_LABELS,
  vendorCategoryLabel,
  vendorTeamStatusSchema,
  type VendorTeamStatus,
} from "@/features/vendors/team";

const NEW = "__new";
const text = (value: unknown) => (typeof value === "string" ? value : "");
const centsText = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? String(Math.round(value) / 100) : "";

/** "$1,200" or "1200.50" as cents; "" as nothing; anything else as not a number. */
function toCents(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").replace(/[$,\s]/g, "");
  if (!raw) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : Number.NaN;
}
const clock = (value: FormDataEntryValue | null) => (/^\d{2}:\d{2}$/.test(String(value ?? "")) ? String(value) : null);
const words = (value: FormDataEntryValue | null) => String(value ?? "").trim() || null;

/**
 * Adding a vendor to a job's team, or changing one (the job's Vendor team).
 *
 * One form for both. Who it is comes from the studio's directory — its
 * preferred vendors — or is typed as someone new, who joins the directory;
 * or nobody yet, for a category the wedding still needs. The vendor's own
 * details (their number, their email) are the directory's, so changing them
 * here changes them everywhere they appear.
 */
export function VendorTeamSheet({
  open,
  onClose,
  onSaved,
  projectId,
  entry,
  directory,
  teamVendorIds,
  client,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  projectId: string;
  /** Null to add a vendor. */
  entry: TeamRecord | null;
  /** The studio's vendors; may be empty for a coordinator who can't read them all. */
  directory: TeamRecord[];
  /** Vendors already on the job, which can't be added twice. */
  teamVendorIds: ReadonlySet<string>;
  /** Who pays the vendors, in the job's words: "the couple", "the family". */
  client: string;
}) {
  const Client = `${client.charAt(0).toUpperCase()}${client.slice(1)}`;
  const adding = entry === null;
  const [category, setCategory] = useState(text(entry?.category) || "florist");
  const [choice, setChoice] = useState(text(entry?.vendorId));
  const [status, setStatus] = useState<VendorTeamStatus>(
    vendorTeamStatusSchema.safeParse(entry?.status).data ?? "needed",
  );
  // Choosing someone for a category that was only needed books them, and
  // clearing who it is puts it back to needed; the studio can change either.
  const choose = (value: string) => {
    setChoice(value);
    if (value && status === "needed") setStatus("booked");
    if (!value && (status === "booked" || status === "considering")) setStatus("needed");
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // The directory, this kind first, archived and already-on-the-team left out
  // (the entry's own vendor stays, so an edit can keep them).
  const options = useMemo(() => {
    const usable = directory.filter(
      (vendor) => !vendor.archivedAt && (!teamVendorIds.has(vendor.id) || vendor.id === text(entry?.vendorId)),
    );
    const byName = (left: TeamRecord, right: TeamRecord) => text(left.company).localeCompare(text(right.company));
    const own = usable.filter((vendor) => vendor.type === category).sort(byName);
    const rest = usable.filter((vendor) => vendor.type !== category).sort(byName);
    const current = text(entry?.vendorId);
    // A coordinator who can't read the directory still sees who the entry is.
    const missing = current && !usable.some((vendor) => vendor.id === current);
    return { own, rest, missing: missing ? { id: current, company: text(entry?.company) || "Current vendor" } : null };
  }, [category, directory, entry, teamVendorIds]);

  const chosen = directory.find((vendor) => vendor.id === choice) ?? null;
  const details = choice === NEW ? null : chosen ?? (choice && choice === text(entry?.vendorId) ? entry : null);

  async function save(form: FormData) {
    setError(null);
    const money = {
      costCents: toCents(form.get("cost")),
      balanceDueCents: toCents(form.get("balanceDue")),
      tipCents: toCents(form.get("tip")),
    };
    if (Object.values(money).some((value) => Number.isNaN(value))) {
      setError("Write amounts in dollars, like 1,200 or 1200.50.");
      return;
    }
    const newVendor =
      choice === NEW
        ? {
            company: String(form.get("company") ?? "").trim(),
            contactName: String(form.get("contactName") ?? "").trim(),
            email: words(form.get("email")),
            phone: words(form.get("phone")),
          }
        : null;
    if (newVendor && !newVendor.company) {
      setError("Add the company's name.");
      return;
    }
    // Their details, when an existing vendor's were changed here.
    const edited =
      !adding && choice && choice !== NEW && details
        ? {
            company: String(form.get("company") ?? "").trim(),
            contactName: String(form.get("contactName") ?? "").trim(),
            email: words(form.get("email")),
            phone: words(form.get("phone")),
          }
        : null;
    const detailsChanged =
      edited &&
      (edited.company !== text(details?.company) ||
        edited.contactName !== text(details?.contactName) ||
        (edited.email ?? "") !== text(details?.email) ||
        (edited.phone ?? "") !== text(details?.phone));
    if (edited && detailsChanged && !edited.company) {
      setError("Add the company's name.");
      return;
    }
    const input = {
      projectId,
      vendorId: choice && choice !== NEW ? choice : null,
      newVendor,
      category,
      roleLabel: words(form.get("roleLabel")),
      status,
      arrivalTime: clock(form.get("arrivalTime")),
      loadInTime: clock(form.get("loadInTime")),
      strikeTime: clock(form.get("strikeTime")),
      contractReceived: form.get("contractReceived") === "on",
      coiReceived: form.get("coiReceived") === "on",
      ...money,
      balanceDueDate: words(form.get("balanceDueDate")),
      notes: words(form.get("notes")),
      ...(adding ? {} : { entryId: text(entry?.entryId), vendorDetails: detailsChanged ? edited : null }),
    };
    setBusy(true);
    try {
      const outcome = await sendPlanningCommand(adding ? "addVendorTeamEntry" : "updateVendorTeamEntry", input);
      if (!outcome.persisted) {
        onSaved("Preview mode — nothing was saved.");
      } else {
        refreshTenantRecords("vendors", "projects");
        const name = newVendor?.company || edited?.company || text(details?.company) || vendorCategoryLabel(category);
        onSaved(adding ? `${name} is on the team.` : `${name} is updated.`);
      }
      onClose();
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That couldn't be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await sendPlanningCommand("removeVendorTeamEntry", { projectId, entryId: text(entry?.entryId) });
      if (outcome.persisted) refreshTenantRecords("vendors", "scheduleShares");
      onSaved(outcome.persisted ? `${text(entry?.company) || vendorCategoryLabel(category)} is off the team.` : "Preview mode — nothing was saved.");
      onClose();
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That couldn't be removed. Try again."));
    } finally {
      setBusy(false);
      setConfirmingRemove(false);
    }
  }

  const title = adding ? "Add a vendor" : text(entry?.company) || vendorCategoryLabel(entry?.category);
  return (
    <SheetDialog label={title} onClose={onClose} open={open} width="wide">
      <form
        className="record-sheet vendor-team-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          void save(new FormData(event.currentTarget));
        }}
      >
        <header>
          <p className="eyebrow">Vendor team</p>
          <h3>{title}</h3>
          <p>
            {adding
              ? "Who they are, where they stand, and when they arrive. Nothing is sent to them."
              : "Changes to their name, email or phone change them in your vendors too."}
          </p>
        </header>
        <div className="record-sheet-fields">
          <label>
            What they do
            <select name="category" onChange={(event) => setCategory(event.target.value)} value={category}>
              {VENDOR_TEAM_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {vendorCategoryLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Who
            <select name="vendor" onChange={(event) => choose(event.target.value)} value={choice}>
              <option value="">Nobody chosen yet</option>
              {options.missing ? <option value={options.missing.id}>{options.missing.company}</option> : null}
              {options.own.length ? (
                <optgroup label={`Your ${vendorCategoryLabel(category).toLowerCase()} vendors`}>
                  {options.own.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {text(vendor.company)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {options.rest.length ? (
                <optgroup label="Your other vendors">
                  {options.rest.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {text(vendor.company)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <option value={NEW}>Someone new…</option>
            </select>
          </label>
          {choice === NEW || details ? (
            <>
              <label>
                Company
                <input defaultValue={text(details?.company)} key={`company-${choice}`} maxLength={200} name="company" required />
              </label>
              <label>
                Contact name
                <input defaultValue={text(details?.contactName)} key={`contact-${choice}`} maxLength={160} name="contactName" />
              </label>
              <label>
                Email
                <input defaultValue={text(details?.email)} key={`email-${choice}`} maxLength={200} name="email" type="email" />
              </label>
              <label>
                Phone
                <input defaultValue={text(details?.phone)} key={`phone-${choice}`} maxLength={40} name="phone" type="tel" />
              </label>
            </>
          ) : null}
          <label>
            Where it stands
            <select name="status" onChange={(event) => setStatus(event.target.value as VendorTeamStatus)} value={status}>
              {(Object.keys(VENDOR_TEAM_STATUS_LABELS) as VendorTeamStatus[]).map((value) => (
                <option key={value} value={value}>
                  {VENDOR_TEAM_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
            {status === "booked" && !choice ? <small>Choose who is booked first.</small> : null}
          </label>
          <label>
            <span>
              Their part <small>optional, e.g. Cocktail hour trio</small>
            </span>
            <input defaultValue={text(entry?.roleLabel)} maxLength={80} name="roleLabel" />
          </label>
          <fieldset className="vendor-team-sheet-group is-wide">
            <legend>On the day</legend>
            <label>
              Arrives
              <input defaultValue={text(entry?.arrivalTime)} name="arrivalTime" type="time" />
            </label>
            <label>
              Load-in
              <input defaultValue={text(entry?.loadInTime)} name="loadInTime" type="time" />
            </label>
            <label>
              Strike
              <input defaultValue={text(entry?.strikeTime)} name="strikeTime" type="time" />
            </label>
          </fieldset>
          <fieldset className="vendor-team-sheet-group is-wide">
            <legend>Money</legend>
            <label>
              Their total
              <input defaultValue={centsText(entry?.costCents)} inputMode="decimal" name="cost" placeholder="$" />
            </label>
            <label>
              {`${Client} still owes`}
              <input defaultValue={centsText(entry?.balanceDueCents)} inputMode="decimal" name="balanceDue" placeholder="$" />
            </label>
            <label>
              Due on
              <input defaultValue={text(entry?.balanceDueDate)} name="balanceDueDate" type="date" />
            </label>
            <label>
              Tip
              <input defaultValue={centsText(entry?.tipCents)} inputMode="decimal" name="tip" placeholder="$" />
            </label>
          </fieldset>
          <label className="vendor-team-sheet-check">
            <input defaultChecked={entry?.contractReceived === true} name="contractReceived" type="checkbox" />
            Their contract is in
          </label>
          <label className="vendor-team-sheet-check">
            <input defaultChecked={entry?.coiReceived === true} name="coiReceived" type="checkbox" />
            Their certificate of insurance is in
          </label>
          <label className="is-wide">
            Notes
            <textarea defaultValue={text(entry?.notes)} maxLength={2000} name="notes" rows={2} />
          </label>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {!adding && confirmingRemove ? (
          <ConfirmStep
            busy={busy}
            cancelLabel="Keep them"
            confirmLabel="Take them off"
            danger
            label="Take them off this job?"
            onCancel={() => setConfirmingRemove(false)}
            onConfirm={() => void remove()}
          >
            {`${text(entry?.company) || vendorCategoryLabel(entry?.category)} comes off this job, and their link to its timeline stops opening. They stay in your vendors.`}
          </ConfirmStep>
        ) : (
          <footer>
            {!adding ? (
              <button className="button button-light vendor-team-sheet-remove" disabled={busy} onClick={() => setConfirmingRemove(true)} type="button">
                Take off this job
              </button>
            ) : null}
            <button className="button button-light" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="button button-dark" disabled={busy || (status === "booked" && !choice)} type="submit">
              {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
              {busy ? "Saving…" : adding ? "Add to the team" : "Save changes"}
            </button>
          </footer>
        )}
      </form>
    </SheetDialog>
  );
}
