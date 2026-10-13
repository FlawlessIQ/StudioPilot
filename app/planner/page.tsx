import { TradeLanding } from "@/components/marketing/trade-landing";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "For Wedding Planners",
  socialTitle: "StudioCue for wedding planners: every vendor on the same timeline, and you know who has it.",
  description:
    "Client and vendor management software for wedding planners: discovery calls, proposals, agreements and retainers, full, partial or month-of tiers, a vendor team with arrival times, balances and tips, and every vendor's timeline sent in one press with confirmations tracked. $75 a month.",
  path: "/planner",
  og: "planner",
});

/** The wedding planner's landing page (planner journey, Phase 5); the copy is in components/marketing/trade-landing.tsx. */
export default function PlannerPage() {
  return <TradeLanding trade="planner" />;
}
