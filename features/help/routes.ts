import { EXPLAINERS, explainer } from "./explainers";
import type { Explainer, HelpAudience } from "./types";

/**
 * Which guide a screen's "How to" button opens.
 *
 * The button is on every studio, couple and crew screen and is never hidden:
 * a screen with no guide of its own opens its audience's tour, so the answer
 * to "how does this work?" is never an empty popup.
 */

const FALLBACK: Record<HelpAudience, string> = {
  studio: "tour",
  couple: "couple-tour",
  crew: "crew-tour",
};

/** `/studio/projects/*` matches one segment; a trailing `/**` matches the rest. */
export function routeMatches(pattern: string, pathname: string): boolean {
  const have = (pathname.replace(/\/+$/, "") || "/").split("/");
  const rest = pattern.endsWith("/**");
  const want = (rest ? pattern.slice(0, -3) : pattern).split("/");
  if (rest ? have.length < want.length : have.length !== want.length) return false;
  return want.every((part, index) => part === "*" || part === have[index]);
}

/** Literal segments count most; a `*` less; a trailing `/**` least. */
function specificity(pattern: string): number {
  return pattern
    .split("/")
    .reduce((score, part) => score + (part === "**" ? 0 : part === "*" ? 1 : 2), 0);
}

/** The audience a pathname belongs to, or null for public pages. */
export function audienceForPath(pathname: string): HelpAudience | null {
  if (pathname === "/studio" || pathname.startsWith("/studio/")) return "studio";
  if (pathname === "/client" || pathname.startsWith("/client/")) return "couple";
  if (pathname === "/crew" || pathname.startsWith("/crew/")) return "crew";
  return null;
}

export type HelpForRoute = {
  /** The guide the popup opens on. */
  primary: Explainer;
  /** Other guides for this screen, and the audience's tour when it isn't primary. */
  related: Explainer[];
  /** True when the screen has no guide of its own and fell back to the tour. */
  fallback: boolean;
};

export function helpForRoute(pathname: string, audience: HelpAudience): HelpForRoute {
  const own = EXPLAINERS.filter((guide) => guide.audience === audience);
  // The most specific match wins: /studio/projects/new over /studio/projects/*.
  const primary = own
    .flatMap((guide) =>
      guide.routes.filter((route) => routeMatches(route, pathname)).map((route) => ({ guide, score: specificity(route) })),
    )
    .sort((a, b) => b.score - a.score)[0]?.guide;
  const alsoOn = own.filter(
    (guide) => guide !== primary && guide.alsoOn?.some((route) => routeMatches(route, pathname)),
  );
  const tour = explainer(FALLBACK[audience]);
  if (!tour) throw new Error(`No tour explainer for ${audience}`);
  if (!primary) return { primary: tour, related: alsoOn, fallback: true };
  return {
    primary,
    related: primary.id === tour.id ? alsoOn : [...alsoOn, tour],
    fallback: false,
  };
}
