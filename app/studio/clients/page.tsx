import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { LiveClientCards } from "@/components/live/tenant-records";
import { PeopleSectionNav } from "@/components/layout/people-section-nav";
import {
  clientListViews,
  type ClientListView,
} from "@/features/contacts/client-search";

export const metadata: Metadata = { title: "Clients" };

const tabLabels: Record<ClientListView, string> = {
  active: "Active",
  prospects: "Prospects",
  archived: "Archived",
};

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
            <p>Keep client details, project relationships, and portal access in one place.</p>
          </div>
          <Link className="button button-dark" href="/studio/clients/new"><Plus size={16} /> Add client</Link>
        </div>
        {/* Below the heading, as on Crew, Team and Vendors. Between the title
            and Add client it floated 18px above the button's line (UI audit,
            2026-10-02). */}
        <PeopleSectionNav />
        <section className="panel crm-table-panel">
          <div className="crm-toolbar">
            {/* A tab keeps the search: the client someone is looking for may
                be the archived one. */}
            <div className="crm-tabs">
              {clientListViews.map((tab) => (
                <Link
                  className={view === tab ? "active" : ""}
                  href={`?${new URLSearchParams(q ? { view: tab, q } : { view: tab })}`}
                  key={tab}
                >
                  {tabLabels[tab]}
                </Link>
              ))}
            </div>
            <form className="crm-search-form" method="get">
              <input name="view" type="hidden" value={view} />
              <Search size={15} />
              {/* Keyed on the query: a client-side visit to another ?q= (a tab,
                  the global search) keeps this page mounted, and an
                  uncontrolled box went on showing the old words over a list
                  that no longer matched them. */}
              <input aria-label="Search clients" defaultValue={q} key={q} name="q" placeholder="Name, email, phone or company" />
              <button type="submit">Search</button>
            </form>
          </div>
          <div className="ds-card ds-people-list">
            <LiveClientCards q={q} view={view} />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
