"use client";

import { useState } from "react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { ExistingBookingForm } from "@/components/imports/existing-booking-form";

/**
 * Where a studio brings in the weddings it booked before StudioCue.
 *
 * Owners and admins only, because an import is the studio's word that a
 * contract was signed and money was paid — the same permission as recording
 * either by hand. The server refuses anyone else regardless; this just saves
 * them filling in a form that can't be submitted.
 */
export function ImportBookingsWorkspace() {
  const workspace = useWorkspace();
  const [formKey, setFormKey] = useState(0);
  const allowed =
    workspace.role === "studio_owner" || workspace.role === "studio_admin";

  if (!workspace.loading && !allowed)
    return (
      <section className="panel booking-import-panel">
        <p>
          Only a studio owner or admin can import bookings, because importing
          one records that its contract was signed and its payments were made.
        </p>
      </section>
    );

  return (
    <section className="panel booking-import-panel">
      <header>
        <h2>One booking</h2>
        <p>
          The couple, the date, what the contract says and what they&rsquo;ve
          paid. Nothing is sent to them.
        </p>
      </header>
      <ExistingBookingForm key={formKey} source="form" />
      <button
        className="booking-import-another"
        onClick={() => setFormKey((value) => value + 1)}
        type="button"
      >
        Start another booking
      </button>
    </section>
  );
}
