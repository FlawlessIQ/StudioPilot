/**
 * In-product help, at three depths: a glossary term behind an ⓘ, a written
 * explainer behind each screen's "How to" button, and — for the golden path —
 * a narrated video on top of the explainer. Plan and rationale:
 * docs/how-to-videos-plan-2026-09-30.md.
 *
 * Everything here is plain data, so the same content renders in the studio,
 * the couple and crew portals, and on the public /how-to pages, and so
 * tests/help-content.test.ts can hold it to the product it describes.
 */

export type HelpAudience = "studio" | "couple" | "crew";

export const HELP_STAGES = [
  "getting-started",
  "every-day",
  "inquiry-to-booking",
  "planning",
  "after-the-wedding",
  "admin",
] as const;
export type HelpStage = (typeof HELP_STAGES)[number];

export const HELP_STAGE_LABELS: Record<HelpStage, string> = {
  "getting-started": "Getting started",
  "every-day": "Every day",
  "inquiry-to-booking": "Inquiry to booking",
  planning: "Planning",
  "after-the-wedding": "After the wedding",
  admin: "Admin",
};

export const HELP_AUDIENCE_LABELS: Record<HelpAudience, string> = {
  studio: "Studios",
  couple: "Clients",
  crew: "Crew",
};

export type HelpTerm = {
  /** Stable id, used by `<InfoHint term="…">` and as the glossary anchor. */
  id: string;
  /** The word as the screen shows it. */
  term: string;
  /** One or two plain sentences, at most 30 words. */
  hint: string;
  audience: HelpAudience;
  /** An explainer that covers this term in depth ("Learn more"). */
  explainer?: string;
};

export type Explainer = {
  /** Stable id, used in /how-to/<id> and `?howto=<id>`. */
  id: string;
  /** Named for the outcome: "Send a proposal", not "The proposals page". */
  title: string;
  /** One sentence, for cards and page descriptions. */
  summary: string;
  audience: HelpAudience;
  stage: HelpStage;
  /**
   * The screens this is the guide for. `*` matches one path segment and a
   * trailing `/**` matches the rest of the path.
   */
  routes: string[];
  /** Screens where it is offered as a related guide rather than the main one. */
  alsoOn?: string[];
  /** What the screen or task is for — one or two sentences. */
  purpose: string;
  /**
   * The steps, in order. A UI label is written **in bold**, spelled exactly
   * as the screen spells it: the content test checks each one still exists.
   */
  steps: string[];
  /** What happens after: what the couple or crew sees, what runs by itself. */
  next?: string;
  /** Gotchas and limits — three at most. */
  goodToKnow?: string[];
  /** Glossary ids shown as chips under the explainer. */
  terms?: string[];
  /** A video in features/help/video-manifest.json, for the golden path. */
  video?: string;
};
