import { Clock3, MapPin } from "lucide-react";
import { AssignmentActions } from "@/components/crew/assignment-actions";
import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { StatusBadge } from "@/components/ui/status-badge";

export default function PendingJobsPage() {
  return <CrewPortalShell active="Pending jobs"><div className="crew-mobile-page"><header className="crew-portal-hero"><div><p className="eyebrow">Invitation queue</p><h1>Pending jobs</h1><p>Review the complete brief, responsibilities, and compensation before responding.</p></div></header><article className="panel crew-invitation-card"><div><span><p className="eyebrow">Lighting assistant · Wedding</p><h2>Sofia &amp; Miles Carter</h2></span><StatusBadge tone="warning">Response due Aug 2</StatusBadge></div><p><MapPin size={15}/> Cedar Lakes Estate, Port Jervis</p><div className="crew-invite-facts"><span><small>Date</small><strong>Aug 22, 2026</strong></span><span><small>Coverage</small><strong>2:00–8:00 PM</strong></span><span><small>Compensation</small><strong>$450 flat</strong></span></div><div className="crew-invite-note"><Clock3 size={16}/><span><strong>Responsibilities</strong><small>Reception lighting and equipment management. Final schedule publishes August 8.</small></span></div><AssignmentActions assignmentId="wedding-ready-assistant" projectId="wedding-ready" initialStatus="invited"/></article></div></CrewPortalShell>;
}
