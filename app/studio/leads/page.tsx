import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Filter, Inbox, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { crmLeads } from "@/config/crm-demo-data";

export const metadata: Metadata = { title: "Leads · StudioHub" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const { view = "open", q = "" } = await searchParams;
  const visibleLeads =
    view === "open"
      ? crmLeads.filter((lead) => lead.name.toLowerCase().includes(q.toLowerCase()))
      : [];
  return (
    <AppShell active="Leads">
      <div className="crm-page">
        <div className="dashboard-heading">
          <div><p className="eyebrow">Pipeline</p><h1>Leads</h1><p>Qualify inquiries and move the right clients toward consultation.</p></div>
          <Link className="button button-dark" href="/inquiry"><Plus size={16} /> Open inquiry form</Link>
        </div>
        <div className="crm-metrics">
          <article><small>New this week</small><strong>7</strong><span className="positive">↑ 3 from last week</span></article>
          <article><small>Awaiting review</small><strong>3</strong><span>Oldest: 2 days</span></article>
          <article><small>Consultations</small><strong>5</strong><span>Next 14 days</span></article>
          <article><small>Conversion</small><strong>42%</strong><span>Rolling 90 days</span></article>
        </div>
        <section className="panel crm-table-panel">
          <div className="crm-toolbar">
            <div className="crm-tabs"><Link className={view === "open" ? "active" : ""} href="?view=open">Open <span>7</span></Link><Link className={view === "converted" ? "active" : ""} href="?view=converted">Converted</Link><Link className={view === "lost" ? "active" : ""} href="?view=lost">Lost</Link></div>
            <form className="crm-search-form" method="get"><input name="view" type="hidden" value={view} /><Search size={15} /><input aria-label="Search leads" defaultValue={q} name="q" placeholder="Search leads" /><button type="submit"><Filter size={14} /> Apply</button></form>
          </div>
          <div className="crm-table crm-leads-table">
            <div className="crm-table-head"><span>Lead</span><span>Event</span><span>Source</span><span>Owner</span><span>Status</span><span /></div>
            {visibleLeads.map((lead) => (
              <article key={lead.id}>
                <span className="crm-primary"><strong>{lead.name}</strong><small>{lead.id} · received {lead.age} ago</small></span>
                <span><strong>{lead.event} · {lead.date}</strong><small>{lead.venue}</small></span>
                <span>{lead.source}</span>
                <span>{lead.assigned}</span>
                <span><StatusBadge tone={lead.status === "New" ? "info" : "warning"} dot>{lead.status}</StatusBadge>{lead.missing > 0 ? <small>{lead.missing} detail{lead.missing > 1 ? "s" : ""} missing</small> : null}</span>
                <Link href={`/studio/leads/${lead.id}`} aria-label={`Open ${lead.name}`}><ArrowUpRight size={16} /></Link>
              </article>
            ))}
          </div>
          {visibleLeads.length === 0 ? <div className="crm-list-empty"><Inbox size={20} /><strong>No {view} leads</strong><span>Try another view or search.</span></div> : null}
          <div className="crm-empty-hint"><Inbox size={15} /><span>Public submissions are rate-limited, duplicate-checked, and tenant-scoped.</span></div>
        </section>
      </div>
    </AppShell>
  );
}
