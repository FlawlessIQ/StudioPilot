import type { ClientNavigation } from "@/server/client/portal-experience";

/**
 * The portal's navigation, from the areas the server says exist.
 *
 * The shell used to hardcode four entries plus one slot derived from the next
 * action, and nine routes competed for that slot — so a run of show holding
 * "Approve this version" was reachable only by typing the URL. The server had
 * been returning a per-area `ClientNavigation` the whole time and no component
 * read it.
 *
 * Pure, so `tests/portal-navigation.test.ts` can hold the rule that an area the
 * server reports is an area the couple can reach. The route-reachability guard
 * cannot hold it: the server's destination map writes `href: "/client/…"` for
 * every area, which reads as a link to a source scan even though only one of
 * them is rendered at a time. Reachability is a property of the *nav*, and
 * this is the nav.
 */

export type ClientAreaItem = {
  label: string;
  href: string;
  /** Lucide icon name, resolved by the shell. Kept as a string so this stays pure. */
  icon:
    | "CalendarCheck"
    | "Package"
    | "ClipboardList"
    | "FileSignature"
    | "ListChecks"
    | "CalendarDays"
    | "Images"
    | "Star";
};

export function clientAreaItems(
  navigation: ClientNavigation | null | undefined,
): ClientAreaItem[] {
  const items: Array<ClientAreaItem | null> = [
    // The event itself — date, venue, who is shooting it. Always there.
    { label: "Your event", href: "/client/project", icon: "CalendarCheck" },
    navigation?.package
      ? { label: "Your package", href: "/client/package", icon: "Package" }
      : null,
    navigation?.proposal
      ? { label: "Your proposal", href: "/client/proposal", icon: "ClipboardList" }
      : null,
    navigation?.contract
      ? { label: "Your agreement", href: "/client/contract", icon: "FileSignature" }
      : null,
    navigation?.questionnaire
      ? { label: "Planning form", href: "/client/questionnaire", icon: "ListChecks" }
      : null,
    navigation?.schedule
      ? { label: "Event-day schedule", href: "/client/schedule", icon: "CalendarDays" }
      : null,
    navigation?.delivery
      ? { label: "Your photographs", href: "/client/delivery", icon: "Images" }
      : null,
    navigation?.reviews
      ? { label: "Share a review", href: "/client/reviews", icon: "Star" }
      : null,
  ];
  return items.filter((item): item is ClientAreaItem => item !== null);
}

/** Every area the server can report, with the page it opens. */
export const CLIENT_AREA_ROUTES: Record<
  keyof ClientNavigation,
  string | null
> = {
  proposal: "/client/proposal",
  package: "/client/package",
  contract: "/client/contract",
  // Always in the nav as a fixed entry, whatever the flag says — a couple
  // with an outstanding balance must never lose the page that shows it.
  payments: null,
  questionnaire: "/client/questionnaire",
  schedule: "/client/schedule",
  // Shared files live on the records page, which is always in the nav.
  files: null,
  delivery: "/client/delivery",
  reviews: "/client/reviews",
};
