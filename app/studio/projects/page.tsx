import type { Metadata } from "next";
import Link from "next/link";
import { Filter, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { LiveProjectRows } from "@/components/live/tenant-records";

export const metadata: Metadata = { title: "Projects · StudioHub" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; type?: string }>;
}) {
  const { view = "active", type = "all" } = await searchParams;
  return (
    <AppShell active="Projects">
      <div className="crm-page">
        <div className="dashboard-heading">
          <div><p className="eyebrow">Operations</p><h1>Projects</h1><p>Dates, project states, owners, and readiness in one operational view.</p></div>
          <Link className="button button-dark" href="/studio/projects/new"><Plus size={16} /> Create project</Link>
        </div>
        <section className="panel crm-table-panel">
          <div className="crm-toolbar">
            <div className="crm-tabs"><Link className={view === "active" ? "active" : ""} href={`?view=active&type=${type}`}>Active <span>12</span></Link><Link className={view === "leads" ? "active" : ""} href={`?view=leads&type=${type}`}>Leads</Link><Link className={view === "archived" ? "active" : ""} href={`?view=archived&type=${type}`}>Archived</Link></div>
            <form className="crm-search-form" method="get"><input name="view" type="hidden" value={view} /><Filter size={15} /><select aria-label="Project type" defaultValue={type} name="type"><option value="all">All project types</option><option value="wedding">Wedding</option><option value="corporate">Corporate</option><option value="sports">Sports</option></select><button type="submit">Apply</button></form>
          </div>
          <div className="crm-table crm-projects-table">
            <div className="crm-table-head"><span>Project</span><span>Date & venue</span><span>State</span><span>Readiness</span><span>Next action</span><span /></div>
            <LiveProjectRows type={type} view={view}/>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
