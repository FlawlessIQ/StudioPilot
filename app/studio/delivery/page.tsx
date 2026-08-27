import { AppShell } from "@/components/layout/app-shell";
import { DeliveryForm } from "@/components/post-event/delivery-form";
import { DeliveryCloseoutWorkspace } from "@/components/post-event/delivery-closeout-workspace";
import { PostProductionChecklist } from "@/components/post-event/post-production-checklist";
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
            {/* Was "StudioCue checks the balance, the contract and the crew
                before anything reaches the couple". It checks none of those —
                the delivery gate requires the backup, the finished edit and a
                ready gallery, which is what the checklist below tracks. Copy
                describing the wrong check sent the walk of 2026-08-26 looking
                for a balance problem that did not exist. */}
            <p>
              Work through post-production, then record the gallery. StudioCue
              will not release a delivery until the cards are backed up, the
              editing is finished and the gallery is ready.
            </p>
          </div>
        </header>
        {project ? <ProjectContextBar projectId={project} /> : null}
        {/* Before the gallery, because it gates the gallery. */}
        {project ? <PostProductionChecklist projectId={project} /> : null}
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
