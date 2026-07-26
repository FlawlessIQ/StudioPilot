import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
  ClipboardPenLine,
  Clock3,
  MapPin,
} from "lucide-react";
import { PortalShell } from "@/components/layout/portal-shell";
import { StatusBadge } from "@/components/ui/status-badge";

export default function ClientPortalPage() {
  return (
    <PortalShell>
      <div className="portal-hero">
        <div>
          <p className="eyebrow">Your wedding photography</p>
          <h1>Hello, Maya.</h1>
          <p>Everything for your day, in one calm place.</p>
        </div>
        <div className="event-countdown">
          <strong>20</strong><span>days to go</span>
        </div>
      </div>
      <section className="client-next-action">
        <span className="next-action-art"><ClipboardPenLine size={25} /></span>
        <div>
          <StatusBadge tone="warning">Your next action</StatusBadge>
          <h2>Review the final run of show</h2>
          <p>Your studio has published version 3. Please review the timing and confirm it looks right.</p>
          <span><Clock3 size={15} /> Due tomorrow · About 5 minutes</span>
        </div>
        <Link className="button button-dark" href="/client#schedule">
          Review schedule <ArrowRight size={16} />
        </Link>
      </section>
      <div className="client-grid">
        <section className="panel">
          <div className="panel-heading">
            <div><h2>Project progress</h2><p>5 of 7 steps complete</p></div>
            <strong>71%</strong>
          </div>
          <div className="progress-track"><i style={{ width: "71%" }} /></div>
          {[
            ["Package selected", "The Signature Collection", true],
            ["Contract signed", "Completed July 2", true],
            ["Retainer paid", "Paid July 2", true],
            ["Questionnaire", "Completed July 18", true],
            ["Schedule approval", "Ready for your review", false],
          ].map(([title, detail, complete]) => (
            <div className="client-check" key={String(title)}>
              <span className={complete ? "complete" : "current"}>
                {complete ? <CircleCheck size={17} /> : <Clock3 size={17} />}
              </span>
              <span><strong>{title}</strong><small>{detail}</small></span>
            </div>
          ))}
        </section>
        <section className="panel event-detail-card">
          <div className="panel-heading"><div><h2>Your event</h2><p>Wedding day details</p></div></div>
          <div className="event-detail">
            <CalendarDays size={18} />
            <span><small>Date</small><strong>Saturday, August 15, 2026</strong></span>
          </div>
          <div className="event-detail">
            <MapPin size={18} />
            <span><small>Venue</small><strong>The Foundry · Long Island City</strong></span>
          </div>
          <div className="studio-contact">
            <span className="avatar avatar-ink">CL</span>
            <span><small>Your studio contact</small><strong>Conor Lawless</strong></span>
            <Link href="/client#messages">Message</Link>
          </div>
        </section>
      </div>
    </PortalShell>
  );
}
