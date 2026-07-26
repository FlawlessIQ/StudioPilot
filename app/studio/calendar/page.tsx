import { CalendarCheck2, Clock3, Video } from "lucide-react";
import { ScheduleConsultationForm } from "@/components/booking/schedule-consultation-form";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { consultations } from "@/config/booking-demo-data";

export default function CalendarPage() {
  return (
    <AppShell active="Calendar">
      <div className="booking-page">
        <header className="page-heading"><div><p className="eyebrow">Booking operations</p><h1>Calendar &amp; consultations</h1><p>Conflict-aware availability with timezone-safe Calendar and Zoom orchestration.</p></div></header>
        <div className="booking-summary-grid">
          <article><CalendarCheck2 /><span><small>Open consultation slots</small><strong>14</strong></span></article>
          <article><Video /><span><small>Zoom meetings this week</small><strong>3</strong></span></article>
          <article><Clock3 /><span><small>Standard duration</small><strong>45 min</strong></span></article>
        </div>
        <div className="booking-layout">
          <section className="panel"><div className="panel-heading"><div><h2>Upcoming consultations</h2><p>Calendar IDs prevent duplicate invitations</p></div></div>
            <div className="booking-list">{consultations.map((item) => <article key={item.id}><span className="booking-date"><strong>{item.date}</strong><small>{item.time}</small></span><span><strong>{item.project}</strong><small>{item.client} · {item.mode} · {item.owner}</small></span><StatusBadge tone={item.status === "Completed" ? "success" : "info"}>{item.status}</StatusBadge></article>)}</div>
          </section>
          <section className="panel booking-form-panel"><div className="panel-heading"><div><h2>Schedule consultation</h2><p>Availability is checked before resources are created</p></div></div><ScheduleConsultationForm /></section>
        </div>
      </div>
    </AppShell>
  );
}
