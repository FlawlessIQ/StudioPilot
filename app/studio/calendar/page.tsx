import { ScheduleConsultationForm } from "@/components/booking/schedule-consultation-form";
import { AppShell } from "@/components/layout/app-shell";
import { LiveDomainView } from "@/components/studio/live-domain-view";

export default function CalendarPage() {
  return (
    <AppShell active="Calendar">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Booking operations</p>
            <h1>Calendar & consultations</h1>
            <p>Timezone-safe Calendar and Zoom orchestration with provider IDs preventing duplicate events.</p>
          </div>
        </header>
        <section>
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Upcoming</p>
              <h2>Consultations</h2>
            </div>
          </div>
          <LiveDomainView domain="consultations" />
        </section>
        <section className="panel booking-form-panel">
          <div className="panel-heading">
            <div>
              <h2>Schedule consultation</h2>
              <p>Availability and conflicts are checked before provider resources are queued.</p>
            </div>
          </div>
          <ScheduleConsultationForm />
        </section>
      </div>
    </AppShell>
  );
}
