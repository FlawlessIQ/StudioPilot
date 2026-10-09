"use client";

import { Card } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { eventHasPassed, portalEmptyNotice, type PortalEmptyArea } from "@/features/client/portal-day";
import { portalPastNotice, portalStageIsBehind, type PortalArea } from "@/features/client/portal-stage";
import { todayLocalIso } from "@/lib/format/event-date";
import { useProject } from "@/components/client/live-client-views";

const EMPTY_AREAS = new Set<string>(["payments", "documents", "delivery", "reviews"]);

/**
 * What a kit screen says when it has nothing to show, in the right tense.
 *
 * Every empty state used to be written for a couple who had just arrived, so
 * thirteen days after a wedding the portal still promised a proposal "being
 * prepared". The old design-system pages learned the difference
 * (features/client/portal-stage.ts, portal-day.ts); the kit screens use the
 * same words through this, with their own sentence for the ordinary case.
 */
export function EmptyMoment({
  area,
  loading,
  error,
  loadingText,
  upcoming,
}: {
  area: PortalArea | PortalEmptyArea;
  loading: boolean;
  error: string | null;
  loadingText: string;
  /** The screen's own words for "not yet", when the stage is still ahead. */
  upcoming: string;
}) {
  const project = useProject();
  // The studio's trade: a makeup artist's client was sent a quote, and a DJ's
  // is never told photos are on the way (features/trades).
  const trade = useWorkspace().tenantTrade;
  if (loading || error)
    return (
      <Card>
        <p className="kit-body" role={error ? "alert" : "status"}>
          {error ?? loadingText}
        </p>
      </Card>
    );
  const milestones = project.value?.milestones ?? null;
  const behind = area !== "payments" && area !== "documents" && portalStageIsBehind(milestones, area as PortalArea);
  const notice = behind
    ? portalPastNotice(area as PortalArea, trade)
    : EMPTY_AREAS.has(area) && eventHasPassed(project.value?.eventDate, todayLocalIso())
      ? portalEmptyNotice(area as PortalEmptyArea, true, trade)
      : null;
  return (
    <Card>
      {notice ? <h2 className="kit-section">{notice.title}</h2> : null}
      <p className="kit-body" role="status">
        {notice?.detail ?? upcoming}
      </p>
    </Card>
  );
}
