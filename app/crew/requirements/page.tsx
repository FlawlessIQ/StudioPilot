import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, ShieldCheck } from "lucide-react";
import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { crewRequirements } from "@/config/crew-demo-data";

export default function CrewRequirementsPage() {
  return <CrewPortalShell active="Requirements"><div className="crew-mobile-page"><header className="crew-portal-hero"><div><p className="eyebrow">Assignment evidence</p><h1>Requirements</h1><p>These deterministic gates decide whether your assignment is event-ready.</p></div></header><div className="crew-requirements-summary"><ShieldCheck/><span><strong>4 of 5 complete</strong><small>One blocker remains for Maya &amp; Theo.</small></span><StatusBadge tone="warning">Not ready</StatusBadge></div><section className="panel crew-requirements-mobile">{crewRequirements.map(item=><article key={item.id}>{item.status==="Complete"?<CheckCircle2 size={19}/>:<AlertTriangle className="crew-warning-icon" size={19}/>}<span><strong>{item.name}</strong><small>{item.detail}</small></span><StatusBadge tone={item.status==="Complete"?"success":"warning"}>{item.status}</StatusBadge>{item.id==="schedule"?<Link href="/crew/schedule" aria-label="Review current schedule"><ChevronRight size={16}/></Link>:null}</article>)}</section><p className="source-note">Payment, signature, and insurance evidence cannot be self-certified. Studio reviewers complete those requirements from provider or document evidence.</p></div></CrewPortalShell>;
}
