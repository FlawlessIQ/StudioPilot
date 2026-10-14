import { TradeLanding } from "@/components/marketing/trade-landing";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "For Hair Stylists",
  socialTitle: "StudioCue for hair stylists: the morning planned, and the extensions ordered on time.",
  description:
    "Booking and scheduling software for bridal hair stylists: quotes priced per person, the agreement and deposit, trials built around the veil, extensions ordered on time, and every chair on the morning laid out. $100 a month.",
  path: "/hair",
  og: "hair",
});

/** The hair landing page (vendor journeys, Phase 6); the copy is in components/marketing/trade-landing.tsx. */
export default function HairPage() {
  return <TradeLanding trade="hair" />;
}
