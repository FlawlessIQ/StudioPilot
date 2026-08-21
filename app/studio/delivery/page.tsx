import { AppShell } from "@/components/layout/app-shell";
import { DeliveryForm } from "@/components/post-event/delivery-form";
import { DeliveryCloseoutWorkspace } from "@/components/post-event/delivery-closeout-workspace";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <AppShell active="Delivery">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Gallery handoff</p>
            <h1>Delivery</h1>
            <p>
              Record the gallery once the edit is finished. StudioCue checks
              the balance, the contract and the crew before anything reaches
              the couple.
            </p>
          </div>
        </header>
        {project ? <ProjectContextBar projectId={project} /> : null}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">New delivery</p>
              <h2>Record gallery</h2>
            </div>
          </div>
          <DeliveryForm projectId={project} />
        </section>
        <DeliveryCloseoutWorkspace projectId={project} />
        <section>
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">History</p>
              <h2>Delivery records</h2>
            </div>
          </div>
          <LiveDomainView domain="delivery" projectId={project} />
        </section>
      </div>
    </AppShell>
  );
}
