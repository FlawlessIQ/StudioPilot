import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { LiveMaybeInquiries } from "@/components/live/tenant-records";
import { InquiryPipelineRows } from "@/components/inquiries/inquiry-pipeline";
import { inquiryViews } from "@/features/inquiries/stages";
import { TenantInquiryLink } from "@/components/crm/tenant-inquiry-link";
import { InquiryForwardingAddress } from "@/components/crm/inquiry-forwarding-address";

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
          <div><p className="eyebrow">Pipeline</p><h1>Inquiries</h1><p>Everyone who hasn&apos;t booked yet, and whose move it is. They become Jobs when they book.</p></div>
          <TenantInquiryLink />
        </div>
        <InquiryForwardingAddress />
        <LiveMaybeInquiries />
        <section className="panel crm-table-panel">
          <div className="crm-toolbar">
            {/* A tab keeps the search: the couple someone is looking for may have closed. */}
            <div className="crm-tabs">{inquiryViews.map(([value, label]) => <Link className={view === value ? "active" : ""} href={`?${new URLSearchParams(q ? { view: value, q } : { view: value })}`} key={value}>{label}</Link>)}</div>
            <form className="crm-search-form" method="get"><input name="view" type="hidden" value={view} /><Search size={15} />{/* Keyed on the query, so an in-app visit to another ?q= shows its words, not the last ones. */}<input aria-label="Search inquiries" defaultValue={q} key={q} name="q" placeholder="Name or email" /><button type="submit">Search</button></form>
          </div>
          <div className="crm-table crm-leads-table inquiry-pipeline-table">
            {/* "Owner" read "Unassigned" on every row — pure noise in a
                one-photographer studio, which is the shape a pilot ships to. */}
            <div className="crm-table-head"><span>Inquiry</span><span>Date</span><span>Source</span><span>Stage</span><span /><span /></div>
            <InquiryPipelineRows view={view} q={q}/>
          </div>
          <div className="crm-empty-hint"><Inbox size={15} /><span>New inquiries are protected from spam and checked for duplicates.</span></div>
        </section>
      </div>
    </AppShell>
  );
}
