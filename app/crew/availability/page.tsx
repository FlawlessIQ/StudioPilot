import { CalendarCheck, CalendarX2, Clock3 } from "lucide-react";
import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { StatusBadge } from "@/components/ui/status-badge";

const dates = [
  { date: "Aug 15", day: "Saturday", status: "Available", detail: "Maya & Theo accepted" },
  { date: "Aug 22", day: "Saturday", status: "Tentative", detail: "Sofia & Miles invitation" },
  { date: "Sep 12", day: "Saturday", status: "Unavailable", detail: "Personal hold" },
] as const;

export default function CrewAvailabilityPage() {
  return <CrewPortalShell active="Availability"><div className="crew-mobile-page"><header className="crew-portal-hero"><div><p className="eyebrow">Your calendar</p><h1>Availability</h1><p>Availability helps the studio shortlist crew; accepted assignments remain authoritative.</p></div></header><section className="panel crew-availability-list">{dates.map(item=><article key={item.date}>{item.status==="Available"?<CalendarCheck/>:item.status==="Unavailable"?<CalendarX2/>:<Clock3/>}<time><strong>{item.date}</strong><small>{item.day}</small></time><span><strong>{item.status}</strong><small>{item.detail}</small></span><StatusBadge tone={item.status==="Available"?"success":item.status==="Unavailable"?"danger":"warning"}>{item.status}</StatusBadge></article>)}</section><p className="source-note">Availability changes are persisted through the authenticated crew service when Firebase is connected. This local view is seeded read-only data.</p></div></CrewPortalShell>;
}
