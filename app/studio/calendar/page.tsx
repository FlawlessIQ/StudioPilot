import Link from "next/link";
import { Settings2 } from "lucide-react";
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
          <Link
            className="button button-dark calendar-availability-cta"
            href="/studio/settings#consultation-availability"
          >
            <Settings2 aria-hidden="true" />
            Manage availability
          </Link>
        </header>
        <StudioCalendar />
      </div>
    </AppShell>
  );
}
