import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { AgreementLinkCard } from "@/components/contracts/agreement-link-card";
import { ProjectBookingWorkspace } from "@/components/booking/project-booking-workspace";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Contracts" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Contracts">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Booking documents & balances</p>
            <h1>Contracts & payments</h1>
            <p>Every agreement and bill, and where each one stands.</p>
          </div>
        </header>
        {project ? <ProjectContextBar projectId={project} /> : null}
        {project ? <ProjectBookingWorkspace projectId={project} /> : null}
        <section>
          <div className="section-heading-row"><div><p className="eyebrow">Agreements</p><h2>Contracts</h2></div></div>
          <LiveDomainView domain="contracts" projectId={project} />
        </section>
        <section>
          <div className="section-heading-row"><div><p className="eyebrow">Provider history</p><h2>Invoices & balances</h2></div></div>
          <LiveDomainView domain="invoices" projectId={project} />
        </section>
        {/* The agreement every contract is written from, after the lists:
            it and a "Choose a project" card stood between the heading and
            the first contract (laptop UI audit, 2026-10-14). Starting a
            booking is the job's Booking tab, so that card is gone. */}
        {project ? null : <AgreementLinkCard />}
      </div>
    </AppShell>
  );
}
