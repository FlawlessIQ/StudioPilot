import { TradeLanding } from "@/components/marketing/trade-landing";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "For Makeup Artists",
  socialTitle: "StudioCue for makeup artists: every chair on the morning, planned from one list.",
  description:
    "Booking and scheduling software for bridal makeup artists: quotes priced per person, the agreement and deposit, trials, and a party list that lays out every chair on the morning. $75 a month.",
  path: "/makeup",
  og: "makeup",
});

/** The makeup landing page (vendor journeys, Phase 6); the copy is in components/marketing/trade-landing.tsx. */
export default function MakeupPage() {
  return <TradeLanding trade="makeup" />;
}
