import { ScheduleConsultationForm } from "@/components/booking/schedule-consultation-form";
import { StudioCalendar } from "@/components/booking/studio-calendar";
import { AppShell } from "@/components/layout/app-shell";
import { LiveDomainView } from "@/components/studio/live-domain-view";

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
        <section>
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Upcoming</p>
              <h2>Consultations</h2>
            </div>
          </div>
          <LiveDomainView domain="consultations" />
        </section>
        <details className="creation-disclosure panel">
          <summary>
            <div>
              <h2>Schedule consultation</h2>
              <p>Choose a project and meeting type, then confirm the time.</p>
            </div>
          </summary>
          <div className="creation-disclosure-body"><ScheduleConsultationForm /></div>
        </details>
      </div>
    </AppShell>
  );
}
