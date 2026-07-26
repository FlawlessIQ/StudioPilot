import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarCheck, MapPin, ShieldCheck } from "lucide-react";
import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { StatusBadge } from "@/components/ui/status-badge";

export default function CrewPortalPage() {
  return <CrewPortalShell><div className="crew-mobile-page">
    <header className="crew-portal-hero"><div><p className="eyebrow">Sunday, July 26</p><h1>Good evening, Jordan.</h1><p>One invitation and one schedule acknowledgement need your attention.</p></div><StatusBadge tone="success" dot>Profile complete</StatusBadge></header>
    <section className="crew-next-action"><AlertTriangle/><span><small>Readiness blocker</small><strong>Acknowledge Maya &amp; Theo’s current schedule</strong><p>Published version 4 replaced the version you acknowledged.</p></span><Link className="button button-dark" href="/crew/schedule">Review v4 <ArrowRight size={15}/></Link></section>
    <div className="crew-portal-grid"><section className="panel crew-upcoming-card"><div><span><p className="eyebrow">Next accepted job</p><h2>Maya &amp; Theo Johnson</h2></span><StatusBadge tone="success">Accepted</StatusBadge></div><p><MapPin size={15}/> The Foundry, Long Island City</p><dl><div><dt>Saturday</dt><dd>Aug 15</dd></div><div><dt>Call time</dt><dd>1:15 PM</dd></div><div><dt>Role</dt><dd>Second photographer</dd></div></dl><Link href="/crew/accepted">Open job brief <ArrowRight size={15}/></Link></section><section className="panel crew-checklist-card"><div><CalendarCheck/><span><p className="eyebrow">Assignment readiness</p><h2>4 of 5 complete</h2></span></div><ul><li><ShieldCheck size={15}/> Calendar added</li><li><ShieldCheck size={15}/> Documents current</li><li className="is-warning"><AlertTriangle size={15}/> Schedule v4 due</li></ul><Link href="/crew/requirements">Review requirements <ArrowRight size={15}/></Link></section></div>
  </div></CrewPortalShell>;
}
