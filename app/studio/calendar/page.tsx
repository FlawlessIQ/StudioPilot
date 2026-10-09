import type { Metadata } from "next";
import { StudioCalendar } from "@/components/booking/studio-calendar";
import { AvailabilityDialog } from "@/components/booking/availability-dialog";
import { AppShell } from "@/components/layout/app-shell";
import { CalendarIntro } from "@/components/studio/page-intros";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <AppShell active="Calendar">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Schedule</p>
            <h1>Calendar</h1>
            {/* Names the studio's own calls: a DJ's vibe calls, a makeup or
                hair studio's trials (it has no consultation). */}
            <p><CalendarIntro /></p>
          </div>
          {/* Was a link to /studio/settings#consultation-availability — an
              anchor that does not exist on that page, so it landed at the
              top of a long settings screen and left the reader to find the
              right card. It opens here instead, over the month they were
              looking at. */}
          {/* Secondary: a setting, not the page's main act — and the only
              way in now, the legend's "Availability settings" link having
              opened this same dialog (UI audit, 2026-10-02). */}
          <AvailabilityDialog className="button button-light calendar-availability-cta" />
        </header>
        <StudioCalendar />
      </div>
    </AppShell>
  );
}
