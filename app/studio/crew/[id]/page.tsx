import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock3, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { crewRequirements } from "@/config/crew-demo-data";

export default function CrewAssignmentDetailPage() {
  return <AppShell active="Crew"><div className="crew-ops-page">
    <Link className="back-link" href="/studio/crew"><ArrowLeft size={15}/> Back to crew</Link>
    <header className="crew-assignment-header"><div><p className="eyebrow">Accepted assignment · AUG 15</p><h1>Maya &amp; Theo Johnson</h1><p>Second photographer · Jordan Reid</p></div><StatusBadge tone="warning" dot>Schedule acknowledgement due</StatusBadge></header>
    <section className="crew-detail-grid">
      <div className="panel crew-brief"><div className="panel-heading"><div><p className="eyebrow">Assignment brief</p><h2>Event-day responsibility</h2></div><UserRound/></div><dl><div><dt>Arrival</dt><dd>1:15 PM</dd></div><div><dt>Departure</dt><dd>9:30 PM</dd></div><div><dt>Compensation</dt><dd>$800 flat · visible to Jordan</dd></div><div><dt>Calendar</dt><dd><CheckCircle2 size={14}/> Added Jul 20</dd></div></dl><h3>Responsibilities</h3><ul><li>Getting-ready candids for partner two</li><li>Ceremony reactions and alternate angles</li><li>Cocktail-hour guest coverage</li></ul><div className="crew-location-note"><MapPin size={16}/><span><strong>The Boro Hotel → The Foundry</strong><small>Parking and venue access included in the mobile brief.</small></span></div></div>
      <aside className="panel crew-readiness-card"><ShieldCheck/><div><p className="eyebrow">Assignment readiness</p><h2>4 of 5 complete</h2><p>Current schedule acknowledgement is the only blocker.</p></div><span className="crew-readiness-track"><i style={{width:"80%"}}/></span><small>Publishing a new schedule automatically resets this acknowledgement.</small></aside>
    </section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Evidence & requirements</p><h2>Current assignment gates</h2></div><span className="sync-label"><Clock3 size={14}/> Provider and human evidence only</span></div><div className="crew-requirement-list">{crewRequirements.map(item=><article key={item.id}><CheckCircle2 className={item.status==="Action required"?"crew-warning-icon":""} size={18}/><span><strong>{item.name}</strong><small>{item.detail}</small></span><StatusBadge tone={item.status==="Complete"?"success":"warning"}>{item.status}</StatusBadge></article>)}</div></section>
  </div></AppShell>;
}
