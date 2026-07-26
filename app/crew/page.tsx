import Link from "next/link";
import {
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { StatusBadge } from "@/components/ui/status-badge";

export default function CrewPortalPage() {
  return (
    <main className="crew-page">
      <header className="crew-header">
        <Link href="/crew"><Logo /></Link>
        <nav aria-label="Crew navigation">
          <Link className="active" href="/crew">Jobs</Link>
          <Link href="#availability">Availability</Link>
          <Link href="#documents">Documents</Link>
        </nav>
        <span className="avatar avatar-ink">JR</span>
      </header>
      <div className="crew-content">
        <div className="crew-welcome">
          <div><p className="eyebrow">Crew workspace</p><h1>Good morning, Jamie.</h1><p>You have one upcoming assignment requiring attention.</p></div>
          <StatusBadge tone="success" dot>Profile complete</StatusBadge>
        </div>
        <section className="crew-job-card">
          <div className="crew-job-banner">
            <span><StatusBadge tone="warning">Action required</StatusBadge><small>Published schedule v3</small></span>
            <strong>Saturday, August 15</strong>
          </div>
          <div className="crew-job-body">
            <div>
              <p className="eyebrow">Second photographer · Wedding</p>
              <h2>Maya &amp; Theo Johnson</h2>
              <span className="crew-location"><MapPin size={16} /> The Foundry, Long Island City</span>
            </div>
            <div className="crew-facts">
              <span><small>Call time</small><strong>1:15 PM</strong></span>
              <span><small>Coverage</small><strong>1:30–9:30 PM</strong></span>
              <span><small>Compensation</small><strong>$800 flat</strong></span>
            </div>
            <div className="crew-alert">
              <Clock3 size={18} />
              <span><strong>Acknowledge the current schedule</strong><small>Version 3 includes a new ceremony start time.</small></span>
              <Link href="#schedule">Review schedule <ArrowRight size={15} /></Link>
            </div>
            <div className="crew-actions">
              <Link className="button button-dark" href="#acknowledgement">
                <CheckCircle2 size={16} /> Acknowledge schedule
              </Link>
              <Link className="button button-light" href="#calendar">
                <CalendarPlus size={16} /> Add to calendar
              </Link>
              <span><ShieldCheck size={16} /> Client financials are hidden</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
