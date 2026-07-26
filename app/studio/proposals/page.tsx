import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { proposals } from "@/config/booking-demo-data";

export default function ProposalsPage() {
  return <AppShell active="Proposals"><div className="booking-page">
    <header className="page-heading"><div><p className="eyebrow">Sales documents</p><h1>Proposals</h1><p>Every revision preserves its package, price, terms, and client snapshots.</p></div><Link className="button button-dark" href="/studio/proposals/PROP-204"><FilePlus2 size={16}/> Open current proposal</Link></header>
    <section className="panel"><div className="panel-heading"><div><h2>Proposal pipeline</h2><p>Immutable versions · branded PDF jobs · view tracking</p></div></div><div className="booking-table">
      <div className="booking-table-head"><span>Project</span><span>Version</span><span>Total</span><span>Expires</span><span>Status</span></div>
      {proposals.map((item) => <Link href={`/studio/proposals/${item.id}`} key={item.id}><span><strong>{item.project}</strong><small>{item.package} · {item.updated}</small></span><span>v{item.version}</span><span>{item.total}</span><span>{item.expires}</span><StatusBadge tone={item.status === "Accepted" ? "success" : item.status === "Viewed" ? "warning" : "info"}>{item.status}</StatusBadge></Link>)}
    </div></section>
  </div></AppShell>;
}
