import type { Metadata } from "next";
import Link from "next/link";
import { Filter, Plus, Upload } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { LiveProjectRows } from "@/components/live/tenant-records";

export const metadata: Metadata = { title: "Jobs" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; type?: string }>;
}) {
  const { view = "active", type = "all" } = await searchParams;
  return (
    <AppShell active="Jobs">
      <div className="crm-page">
        <div className="dashboard-heading">
          <div><p className="eyebrow">Your work</p><h1>Jobs</h1><p>Every wedding and event you are working on, and what each one needs next.</p></div>
          <span className="dashboard-heading-actions">
            {/* Studios arrive with a year of weddings already booked. */}
            <Link className="button button-light" href="/studio/projects/import"><Upload size={16} /> Import bookings</Link>
            <Link className="button button-dark" href="/studio/projects/new"><Plus size={16} /> Create project</Link>
          </span>
        </div>
        <section className="panel crm-table-panel">
          <div className="crm-toolbar">
            <div className="crm-tabs"><Link className={view === "active" ? "active" : ""} href={`?view=active&type=${type}`}>Active</Link><Link className={view === "archived" ? "active" : ""} href={`?view=archived&type=${type}`}>Archived</Link></div>
            {/* Phones: the new-job button lives on the tab row (the hero is hidden)
                and the type filter is a row of one-tap chips instead of a
                select + Apply. Both are hidden on wider screens. */}
            <Link className="crm-toolbar-new" href="/studio/projects/new"><Plus size={15} /> New</Link>
            <nav aria-label="Project type" className="crm-type-chips">{[["all", "All"], ["wedding", "Wedding"], ["corporate", "Corporate"], ["sports", "Sports"]].map(([value, label]) => <Link aria-current={type === value ? "page" : undefined} className={type === value ? "active" : ""} href={`?view=${view}&type=${value}`} key={value}>{label}</Link>)}</nav>
            <form className="crm-search-form" method="get"><input name="view" type="hidden" value={view} /><Filter size={15} /><select aria-label="Project type" defaultValue={type} name="type"><option value="all">All project types</option><option value="wedding">Wedding</option><option value="corporate">Corporate</option><option value="sports">Sports</option></select><button type="submit">Apply</button></form>
          </div>
          <div className="crm-table crm-projects-table">
            <div className="crm-table-head"><span>Project</span><span>Date & venue</span><span>State</span><span>Value</span><span>Next action</span><span /></div>
            <LiveProjectRows type={type} view={view}/>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
