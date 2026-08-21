import Link from "next/link";
import {
  ArrowRight,
  CreditCard,
  Plug,
  Sparkles,
  UsersRound,
} from "lucide-react";

/**
 * The rest of the studio's settings.
 *
 * The nav collapsed to Today and Jobs deliberately, which means everything
 * administrative has to be reachable from one place. Billing in particular
 * had no inbound link anywhere in the product — a studio owner could not
 * find their own subscription — and integrations survived only as a
 * sentence inside a calendar warning.
 */
const DESTINATIONS = [
  {
    href: "/studio/integrations",
    icon: Plug,
    title: "Integrations",
    detail:
      "Your calendar, meetings, files, contracts, and accounting — connect or disconnect any of them.",
  },
  {
    href: "/studio/subscription",
    icon: CreditCard,
    title: "Plan & billing",
    detail: "What you're on, what it includes, and your invoices.",
  },
  {
    href: "/studio/team",
    icon: UsersRound,
    title: "Team",
    detail: "Who can see and do what in this workspace.",
  },
  {
    href: "/studio/setup",
    icon: Sparkles,
    title: "Finish setting up",
    detail:
      "Your packages, agreement, details form, and consultation hours — the four questions.",
  },
] as const;

export function SettingsDestinations() {
  return (
    <section className="settings-destinations" aria-label="More settings">
      {DESTINATIONS.map((destination) => {
        const Icon = destination.icon;
        return (
          <Link href={destination.href} key={destination.href}>
            <span className="settings-destination-icon">
              <Icon size={17} />
            </span>
            <span>
              <strong>{destination.title}</strong>
              <small>{destination.detail}</small>
            </span>
            <ArrowRight size={15} />
          </Link>
        );
      })}
    </section>
  );
}
