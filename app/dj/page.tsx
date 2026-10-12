import { TradeLanding } from "@/components/marketing/trade-landing";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "For Wedding DJs",
  socialTitle: "StudioCue for DJs: the night planned, and every name said right.",
  description:
    "Booking and planning software for wedding DJs: inquiries, proposals, agreements and deposits, a Music & moments planner your couples fill in, and the night laid out with your MC script. $75 a month.",
  path: "/dj",
  og: "dj",
});

/** The DJ landing page (vendor journeys, Phase 6); the copy is in components/marketing/trade-landing.tsx. */
export default function DjPage() {
  return <TradeLanding trade="dj" />;
}
