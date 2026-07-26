import Link from "next/link";
import { CalendarDays, Camera, CheckCircle2, MapPin, ShieldCheck } from "lucide-react";
import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { StatusBadge } from "@/components/ui/status-badge";

export default function CrewProfilePage() {
  return <CrewPortalShell active="Profile"><div className="crew-mobile-page"><header className="crew-portal-hero"><div><p className="eyebrow">Crew profile</p><h1>Jordan Reid</h1><p>Wedding and event photographer · New York City</p></div><StatusBadge tone="success">Active</StatusBadge></header><section className="crew-profile-detail"><article className="panel"><div className="crew-profile-title"><span className="avatar avatar-sand">JR</span><span><h2>Professional details</h2><small>Visible only to permitted studio operators</small></span></div><dl><div><dt><Camera size={15}/> Specialties</dt><dd>Weddings, events</dd></div><div><dt><MapPin size={15}/> Service area</dt><dd>NYC + Hudson Valley · 75 miles</dd></div><div><dt><ShieldCheck size={15}/> Documents</dt><dd>W-9, insurance, contract current</dd></div></dl></article><article className="panel"><p className="eyebrow">Equipment</p><h2>Event-ready kit</h2><ul><li><CheckCircle2/> Dual camera bodies</li><li><CheckCircle2/> 70–200mm f/2.8</li><li><CheckCircle2/> On-camera flash</li></ul><Link className="button button-light" href="/crew/availability"><CalendarDays size={16}/> Manage availability</Link></article></section></div></CrewPortalShell>;
}
