import { StudioCalendar } from "@/components/booking/studio-calendar";
import { AvailabilityDialog } from "@/components/booking/availability-dialog";
import { AppShell } from "@/components/layout/app-shell";

export default function CalendarPage() {
  return (
    <AppShell active="Calendar">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Schedule</p>
            <h1>Calendar</h1>
            <p>See event dates and consultations, then schedule without calendar conflicts or duplicate meetings.</p>
          </div>
          {/* Was a link to /studio/settings#consultation-availability — an
              anchor that does not exist on that page, so it landed at the
              top of a long settings screen and left the reader to find the
              right card. It opens here instead, over the month they were
              looking at. */}
          <AvailabilityDialog className="button button-dark calendar-availability-cta" />
        </header>
        <StudioCalendar />
      </div>
    </AppShell>
  );
}
