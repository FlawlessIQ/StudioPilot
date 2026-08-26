import type { Metadata } from "next";
import Link from "next/link";
import { Filter, Inbox, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { LiveLeadRows } from "@/components/live/tenant-records";
import { TenantInquiryLink } from "@/components/crm/tenant-inquiry-link";

export const metadata: Metadata = { title: "Inquiries" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const { view = "open", q = "" } = await searchParams;
  return (
    <AppShell active="Inquiries">
      <div className="crm-page">
        <div className="dashboard-heading">
          <div><p className="eyebrow">Pipeline</p><h1>Inquiries</h1><p>Review new inquiries and move the right clients toward consultation.</p></div>
          <TenantInquiryLink />
        </div>
        <section className="panel crm-table-panel">
          <div className="crm-toolbar">
            <div className="crm-tabs"><Link className={view === "open" ? "active" : ""} href="?view=open">Open</Link><Link className={view === "converted" ? "active" : ""} href="?view=converted">Converted</Link><Link className={view === "lost" ? "active" : ""} href="?view=lost">Lost</Link></div>
            <form className="crm-search-form" method="get"><input name="view" type="hidden" value={view} /><Search size={15} /><input aria-label="Search leads" defaultValue={q} name="q" placeholder="Search leads" /><button type="submit"><Filter size={14} /> Apply</button></form>
          </div>
          <div className="crm-table crm-leads-table">
            {/* "Owner" read "Unassigned" on every row — pure noise in a
                one-photographer studio, which is the shape a pilot ships to. */}
            <div className="crm-table-head"><span>Lead</span><span>Event</span><span>Source</span><span>Status</span><span /></div>
            <LiveLeadRows view={view} q={q}/>
          </div>
          <div className="crm-empty-hint"><Inbox size={15} /><span>New inquiries are protected from spam and checked for duplicates.</span></div>
        </section>
      </div>
    </AppShell>
  );
}
