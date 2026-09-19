"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { crewPublicError } from "@/lib/crew/public-error";

/**
 * The crew trust dial.
 *
 * Booking works out who a job still has to hire and prepares the offers. By
 * default it stops there and the studio sends them, because an offer carries a
 * fee and the product's rule is that a consequential outward action keeps a
 * human approval point.
 *
 * A studio that has watched the ranking for a while and wants it to run
 * without them turns it on here. Owner-only, and audited server-side, because
 * this is the switch that lets money leave the building on a shortlist nobody
 * read.
 */
export function CrewOfferSettings() {
  const workspace = useWorkspace();
  const isOwner = workspace.role === "studio_owner";
  const { records: tenants } = useTenantDocuments("tenants", {
    enabled: isOwner,
  });
  const tenant = tenants?.find((entry) => entry.id === workspace.tenantId);
  const stored =
    typeof tenant?.crewOffers === "object" && tenant.crewOffers
      ? (tenant.crewOffers as Record<string, unknown>)
      : {};

  const [autoOffer, setAutoOffer] = useState<boolean | null>(null);
  const [windowHours, setWindowHours] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOwner)
    return (
      <p className="form-notice">
        Only the studio owner can change how crew offers are sent.
      </p>
    );

  const effectiveAuto = autoOffer ?? stored.autoOfferOnBooking === true;
  const effectiveWindow =
    windowHours ?? String(Number(stored.responseWindowHours ?? 24));

  async function save() {
    const hours = Math.round(Number(effectiveWindow));
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
      setError("A response window is between 1 and 168 hours.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await sendCrewCommand("setCrewOfferSettings", {
        autoOfferOnBooking: effectiveAuto,
        responseWindowHours: hours,
      });
      setSaved(true);
    } catch (caught: unknown) {
      setError(
        crewPublicError(caught, "That setting could not be saved."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="crm-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="crm-form-grid">
        <label className="form-checkbox">
          <input
            checked={effectiveAuto}
            onChange={(event) => {
              setAutoOffer(event.target.checked);
              setSaved(false);
            }}
            type="checkbox"
          />
          <span>Send prepared crew offers as soon as a job is booked</span>
          <small>
            Off, the plan waits on the job for you to send. On, the first name
            for each role is asked straight away — including the fee. Imported
            bookings are never offered automatically, because they were usually
            staffed before they reached StudioCue.
          </small>
        </label>
        <label>
          Response window (hours)
          <input
            max="168"
            min="1"
            onChange={(event) => {
              setWindowHours(event.target.value);
              setSaved(false);
            }}
            type="number"
            value={effectiveWindow}
          />
          <small>
            How long each person has before the offer moves to the next name.
          </small>
        </label>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="form-notice" role="status">
          <CheckCircle2 size={15} /> Saved. This applies to jobs booked from
          now on.
        </p>
      ) : null}
      <button className="button button-dark" disabled={busy} type="submit">
        {busy ? <LoaderCircle className="spin" size={16} /> : null}
        Save
      </button>
    </form>
  );
}
