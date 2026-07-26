import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { crmClients } from "@/config/crm-demo-data";

export const metadata: Metadata = { title: "Clients · StudioHub" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const { q = "", view = "active" } = await searchParams;
  const visibleClients = view === "active"
    ? crmClients.filter((client) => client.name.toLowerCase().includes(q.toLowerCase()))
    : [];
  return (
    <AppShell active="Clients">
      <div className="crm-page">
        <div className="dashboard-heading">
          <div><p className="eyebrow">Relationships</p><h1>Clients</h1><p>Tenant contacts, project access, and the latest conversation.</p></div>
          <Link className="button button-dark" href="/studio/clients/new"><Plus size={16} /> Add client</Link>
        </div>
        <section className="panel crm-table-panel">
          <div className="crm-toolbar"><div className="crm-tabs"><Link className={view === "active" ? "active" : ""} href="?view=active">Active <span>38</span></Link><Link className={view === "prospects" ? "active" : ""} href="?view=prospects">Prospects</Link><Link className={view === "archived" ? "active" : ""} href="?view=archived">Archived</Link></div><form className="crm-search-form" method="get"><input name="view" type="hidden" value={view} /><Search size={15} /><input aria-label="Search clients" defaultValue={q} name="q" placeholder="Search clients" /><button type="submit">Search</button></form></div>
          <div className="client-card-grid">
            {visibleClients.map((client) => (
              <article key={client.id}>
                <div className="client-card-head"><span className="avatar avatar-sand">{client.initials}</span><StatusBadge tone={client.portal === "Active" ? "success" : "info"}>{client.portal}</StatusBadge></div>
                <h2>{client.name}</h2><p>{client.email}</p>
                <dl><div><dt>Project</dt><dd>{client.project}</dd></div><div><dt>Latest</dt><dd>{client.lastContact}</dd></div></dl>
                <a href={`mailto:${client.email}`}><Mail size={15} /> Message client</a>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
