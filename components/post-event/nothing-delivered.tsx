"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProjectContextBar } from "@/components/studio/live-domain-view";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";

/**
 * After the day, for a studio with nothing to deliver.
 *
 * A DJ, a makeup artist or a hair stylist does the work on the day, so their
 * jobs go from the day to the review and closing (trades.ts
 * NO_DELIVERY_MOVES), never through post-production or a release. The job
 * page drops its Delivery tab for them (project-workspace-nav.tsx), but the
 * routes still answer a typed URL and Cue's cards still mount the release form
 * and the post-production checklist — both written for backed-up cards, an
 * edit and a link the client opens. Those screens show this instead.
 */
export function useDelivers(): boolean {
  return tradeProfile(useWorkspace().tenantTrade).delivery;
}

export function NothingDelivered({ projectId }: { projectId?: string }) {
  const words = tradeVocab(useWorkspace().tenantTrade);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{words.afterPhase}</p>
          <h2>Nothing to deliver</h2>
        </div>
      </div>
      <p>
        Your work is all on the day, so there&rsquo;s nothing to send afterwards. From the day, a job goes
        straight to the review and closing.
      </p>
      {projectId ? (
        <Link className="button button-light" href={`/studio/projects/${projectId}`}>
          Open the job <ArrowRight aria-hidden="true" size={15} />
        </Link>
      ) : null}
    </section>
  );
}

/**
 * A delivery screen's content, or the plain answer for a studio that delivers
 * nothing. `page` keeps the job's context bar above it, as the delivery pages
 * show it, so a job opened here still has its tabs.
 */
export function DeliveryOnly({
  projectId,
  page = false,
  children,
}: {
  projectId?: string;
  page?: boolean;
  children: React.ReactNode;
}) {
  const delivers = useDelivers();
  if (delivers) return <>{children}</>;
  if (!page) return <NothingDelivered projectId={projectId} />;
  return (
    <div className="live-domain-page">
      {projectId ? <ProjectContextBar projectId={projectId} /> : null}
      <NothingDelivered projectId={projectId} />
    </div>
  );
}
