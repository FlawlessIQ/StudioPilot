import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { JOB_KIND_LABELS, JOB_KINDS } from "@/features/job-kinds/job-kinds";
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
          <div><p className="eyebrow">Your work</p><h1>Jobs</h1><p>Every booked wedding and event, and what each one needs next. Couples who haven&apos;t booked yet are under <Link href="/studio/leads">Inquiries</Link>.</p></div>
          <span className="dashboard-heading-actions">
            {/* Studios arrive with a year of weddings already booked. */}
            <Link className="button button-light" href="/studio/projects/import"><Upload size={16} /> Import bookings</Link>
            <Link className="button button-dark" href="/studio/projects/new"><Plus size={16} /> New job</Link>
          </span>
        </div>
        <section className="panel crm-table-panel">
          <div className="crm-toolbar">
            <div className="crm-tabs"><Link className={view === "active" ? "active" : ""} href={`?view=active&type=${type}`}>Active</Link><Link className={view === "archived" ? "active" : ""} href={`?view=archived&type=${type}`}>Archived</Link></div>
            {/* Phones: the new-job button lives on the tab row (the hero is
                hidden). The type filter is a row of one-tap chips at every
                width — a select plus an "Apply" button was a third search
                pattern beside Inquiries' and Clients' (UI audit, 2026-10-02). */}
            <Link className="crm-toolbar-new" href="/studio/projects/new"><Plus size={15} /> New</Link>
            <nav aria-label="Project type" className="crm-type-chips">{[["all", "All"], ...JOB_KINDS.map((kind) => [kind, JOB_KIND_LABELS[kind]])].map(([value, label]) => <Link aria-current={type === value ? "page" : undefined} className={type === value ? "active" : ""} href={`?view=${view}&type=${value}`} key={value}>{label}</Link>)}</nav>
          </div>
          <div className="crm-table crm-projects-table">
            <div className="crm-table-head"><span>Job</span><span>Date & venue</span><span>State</span><span>Value</span><span>Next action</span><span /></div>
            <LiveProjectRows type={type} view={view}/>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
