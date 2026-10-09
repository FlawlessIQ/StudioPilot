import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { DeliveryForm } from "@/components/post-event/delivery-form";
import { DeliveryCloseoutWorkspace } from "@/components/post-event/delivery-closeout-workspace";
import { PostProductionChecklist } from "@/components/post-event/post-production-checklist";
import { DeliveryOnly } from "@/components/post-event/nothing-delivered";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Delivery" };

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <AppShell active="Delivery">
      <div className="live-domain-page">
        {/* A DJ, makeup artist or hair stylist delivers nothing after the day
            (trades.ts), so none of this page is theirs: no backed-up cards, no
            release, no records. The job page has no Delivery tab for them, but
            a typed URL or an old link still lands here. */}
        <DeliveryOnly page projectId={project}>
          {/* Opened for a job, the job's bar is the heading, as on Booking and
              Plan, so the job's tabs stay put between tabs. */}
          {project ? (
            <ProjectContextBar projectId={project} />
          ) : (
            <header className="page-heading">
              <div>
                <p className="eyebrow">Gallery handoff</p>
                <h1>Delivery</h1>
                {/* Was "StudioCue checks the balance, the contract and the crew
                    before anything reaches the couple". It checks none of those.
                    Then it said the edit and a ready gallery gated release too;
                    the gate is the backup alone (DELIVERY_GATE_STEPS in
                    features/post-production/checklist.ts, and the release command
                    in functions/src/post-event/release.ts). Copy describing the
                    wrong check sends a studio hunting for a block that isn't
                    there. */}
                <p>
                  Work through post-production, then record the gallery. The one
                  step StudioCue requires before anything goes to the couple is
                  backing up the cards; the rest of the checklist tracks your
                  progress.
                </p>
              </div>
            </header>
          )}
          {/* Before the gallery, because it gates the gallery. */}
          {project ? <PostProductionChecklist projectId={project} /> : null}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">New release</p>
                <h2>Send photos or a film</h2>
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
        </DeliveryOnly>
      </div>
    </AppShell>
  );
}
