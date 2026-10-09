"use client";

import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeProfile } from "@/features/trades/trades";

/**
 * The studio's review requests, in its own trade's terms.
 *
 * A photographer's asks are tied to the delivery: they are scheduled when the
 * gallery goes out. A DJ, makeup artist or hair stylist delivers nothing
 * (trades.ts), so their asks follow the day itself, and "delivery-linked"
 * would describe a step their jobs never take.
 */
export function StudioReviewsPage({ projectId }: { projectId?: string }) {
  const delivers = tradeProfile(useWorkspace().tenantTrade).delivery;
  return (
    <StudioDomainPage
      domain="reviews"
      eyebrow="Reputation workflow"
      title="Review requests"
      description={
        delivers
          ? "Delivery-linked requests that stop only after explicit client or studio confirmation."
          : "Requests after the day that stop only after explicit client or studio confirmation."
      }
      projectId={projectId}
    />
  );
}
