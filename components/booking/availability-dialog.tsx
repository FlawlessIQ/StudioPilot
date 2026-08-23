"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { ConsultationAvailability } from "@/components/settings/consultation-availability";
import { SheetDialog } from "@/components/ui/sheet-dialog";

/**
 * Consultation hours, edited from the calendar.
 *
 * Both routes to availability used to leave the page for Studio settings.
 * The header button aimed at `#consultation-availability`, an anchor that
 * did not exist on that page, so it landed at the top; the legend link did
 * not even try. Either way the studio arrived on a long settings page and
 * had to find the one card among many that governs their booking link.
 *
 * `ConsultationAvailability` takes no props and loads and saves itself, so
 * the same component that lives on the settings page renders here — one
 * implementation, two places to reach it.
 */
export function AvailabilityDialog({
  className,
  label = "Manage availability",
  variant = "button",
}: {
  className?: string;
  label?: string;
  /**
   * "button" for the page header, "link" for the calendar legend,
   * "inline" for the day panel's sentence about missing hours.
   */
  variant?: "button" | "link" | "inline";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={
          className ??
          (variant === "link"
            ? "ds-cal-legend-link"
            : variant === "inline"
              ? "inline-link-button"
              : "button button-dark")
        }
        onClick={() => setOpen(true)}
        type="button"
      >
        {variant === "inline" ? null : (
          <Settings2 aria-hidden="true" size={variant === "link" ? 13 : undefined} />
        )}
        {label}
      </button>
      <SheetDialog
        label="Consultation availability"
        onClose={() => setOpen(false)}
        open={open}
      >
        <ConsultationAvailability />
      </SheetDialog>
    </>
  );
}
