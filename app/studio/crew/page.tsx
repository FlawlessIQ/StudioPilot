import Link from "next/link";
import { AlertTriangle, CalendarCheck, ChevronRight, FileWarning, UserPlus, UsersRound } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { crewAssignments, crewProfiles } from "@/config/crew-demo-data";

export default function StudioCrewPage() {
  return <AppShell active="Crew"><div className="crew-ops-page">
    <header className="page-heading"><div><p className="eyebrow">People & assignments</p><h1>Crew operations</h1><p>Know who is available, accepted, documented, calendared, and current on the final schedule.</p></div><Link className="button button-dark" href="/studio/crew/new"><UserPlus size={16}/> Add crew member</Link></header>
    <section className="crew-metrics" aria-label="Crew summary">
      <article className="panel"><UsersRound/><span><small>Active relationships</small><strong>14</strong><em>Unlimited on Studio</em></span></article>
      <article className="panel"><CalendarCheck/><span><small>Accepted assignments</small><strong>18</strong><em>Next 60 days</em></span></article>
      <article className="panel"><AlertTriangle/><span><small>Acknowledgements due</small><strong>3</strong><em>Affect readiness</em></span></article>
      <article className="panel"><FileWarning/><span><small>Documents expiring</small><strong>1</strong><em>Within 30 days</em></span></article>
    </section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Upcoming assignments</p><h2>Every role, one accountable owner</h2></div><StatusBadge tone="warning" dot>2 actions due</StatusBadge></div><div className="crew-assignment-table"><div className="crew-table-head"><span>Assignment</span><span>Crew</span><span>Status</span><span>Schedule</span><span/></div>{crewAssignments.map(item=><Link href={`/studio/crew/${item.id}`} key={item.id}><span><strong>{item.project}</strong><small>{item.date} · {item.role}</small></span><span>{item.crew}</span><StatusBadge tone={item.status==="Accepted"?"success":"warning"}>{item.status}</StatusBadge><span><small>{item.schedule}</small></span><ChevronRight size={16}/></Link>)}</div></section>
    <section><div className="section-heading-row"><div><p className="eyebrow">Crew directory</p><h2>Trusted collaborators</h2></div></div><div className="crew-profile-grid">{crewProfiles.map(profile=><article className="panel crew-profile-card" key={profile.id}><div><span className="avatar avatar-sand">{profile.initials}</span><span><h2>{profile.name}</h2><small>{profile.specialties}</small></span><StatusBadge tone={profile.documents==="Complete"?"success":"warning"}>{profile.documents}</StatusBadge></div><dl><div><dt>Service area</dt><dd>{profile.area}</dd></div><div><dt>Assignments</dt><dd>{profile.assignments}</dd></div></dl><footer><span>{profile.availability}</span><Link href={`/studio/crew/${profile.id}`}>View profile <ChevronRight size={14}/></Link></footer></article>)}</div></section>
  </div></AppShell>;
}
