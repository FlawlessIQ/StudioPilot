import { StudioCalendar } from "@/components/booking/studio-calendar";
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
        </header>
        <StudioCalendar />
      </div>
    </AppShell>
  );
}
