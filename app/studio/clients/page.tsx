import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { LiveClientCards } from "@/components/live/tenant-records";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const { q = "", view = "active" } = await searchParams;
  return (
    <AppShell active="Clients">
      <div className="crm-page">
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">Relationships</p>
            <h1>Clients</h1>
            <p>Tenant contacts and secure project-portal activation.</p>
          </div>
        </div>
        <section className="panel crm-table-panel">
          <div className="crm-toolbar">
            <div className="crm-tabs">
              <Link className={view === "active" ? "active" : ""} href="?view=active">
                Active
              </Link>
              <Link className={view === "prospects" ? "active" : ""} href="?view=prospects">
                Prospects
              </Link>
              <Link className={view === "archived" ? "active" : ""} href="?view=archived">
                Archived
              </Link>
            </div>
            <form className="crm-search-form" method="get">
              <input name="view" type="hidden" value={view} />
              <Search size={15} />
              <input aria-label="Search clients" defaultValue={q} name="q" placeholder="Search clients" />
              <button type="submit">Search</button>
            </form>
          </div>
          <div className="client-card-grid">
            <LiveClientCards q={q} view={view} />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
