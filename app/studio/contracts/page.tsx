import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { contracts } from "@/config/booking-demo-data";

export default function ContractsPage() {
  return <AppShell active="Contracts"><div className="booking-page"><header className="page-heading"><div><p className="eyebrow">Docusign evidence</p><h1>Contracts</h1><p>StudioHub reflects provider status; only a completed envelope satisfies the booking gate.</p></div></header><div className="evidence-banner"><ShieldCheck/><div><strong>No signature inference</strong><p>Views and partial signatures are tracked, but never treated as completion.</p></div></div><section className="panel"><div className="booking-table"><div className="booking-table-head"><span>Project</span><span>Envelope</span><span>Signers</span><span>Updated</span><span>Status</span></div>{contracts.map((item)=><div key={item.id}><span><strong>{item.project}</strong><small>{item.id}</small></span><span>{item.envelope}</span><span>{item.signers}</span><span>{item.updated}</span><StatusBadge tone={item.status==="Completed"?"success":item.status==="Partially signed"?"warning":"info"}>{item.status}</StatusBadge></div>)}</div></section></div></AppShell>;
}
