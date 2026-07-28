import { AppShell } from "@/components/layout/app-shell";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Contracts">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Booking documents & balances</p>
            <h1>Contracts & payments</h1>
            <p>Track signatures and QuickBooks balances together without treating either as complete before its provider confirms it.</p>
          </div>
        </header>
        {project ? <ProjectContextBar projectId={project} /> : null}
        <section>
          <div className="section-heading-row"><div><p className="eyebrow">Docusign</p><h2>Contracts</h2></div></div>
          <LiveDomainView domain="contracts" projectId={project} />
        </section>
        <section>
          <div className="section-heading-row"><div><p className="eyebrow">QuickBooks</p><h2>Invoices & balances</h2></div></div>
          <LiveDomainView domain="invoices" projectId={project} />
        </section>
      </div>
    </AppShell>
  );
}
