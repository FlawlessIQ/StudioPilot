/**
 * The shape of a how-to video script (scripts/how-to/videos/<id>.ts).
 *
 * A script is narration plus the actions that show it, step by step. Each
 * step's narration is generated first; the recorder then runs the step's
 * actions while that narration "plays" and holds until it would finish, so
 * picture and voice line up without anyone nudging anything.
 *
 * Targets are found by role and visible label — the same words the narration
 * says — so a renamed button fails the recording loudly instead of the video
 * going quietly out of date.
 */

export type Target =
  | { role: "button" | "link" | "heading" | "tab" | "textbox" | "checkbox" | "dialog" | "region"; name: string | RegExp; exact?: boolean; nth?: number }
  | { text: string | RegExp; exact?: boolean; nth?: number }
  | { css: string; nth?: number };

export type Action =
  | { goto: string }
  | { click: Target }
  /** Clicks the target if it shows within a few seconds; otherwise carries on. */
  | { clickIfShown: Target; withinMs?: number }
  | { hover: Target }
  | { spotlight: Target; holdMs?: number }
  | { scrollTo: Target }
  | { scrollBy: number }
  | { type: { into: Target; text: string } }
  /** Sets a value at once — for date pickers and selects, where typing is fiddly. */
  | { fill: { into: Target; value: string } }
  | { key: string }
  | { reload: true }
  /**
   * Runs the actions, then removes the time they took from the video — for
   * waits nobody should have to watch, like a PDF being made. The last frame
   * of the cut is kept, so the video jumps straight to the result.
   */
  | { cut: Action[] }
  | { waitFor: Target; timeoutMs?: number }
  | { wait: number }
  | { card: { eyebrow?: string; title: string; subtitle?: string } }
  /**
   * Shows the newest email the story sent whose subject matches, as it would
   * land in a phone's inbox. Journey films only: the email is the real
   * template, captured as the email worker rendered it (HOW_TO_EMAIL_DIR).
   */
  | { email: { subject: RegExp; to?: string } }
  /**
   * Moves the story on behind the camera — a scheduler run, a couple's reply,
   * the clock jumping weeks ahead — and cuts the time it took from the video.
   * Journey films only; the name is a beat in scripts/how-to/journey/story.ts.
   */
  | { story: string }
  /**
   * Answers the next request to `url` with the story's named response — for a
   * model call the emulator can't make (scripts/how-to/journey/story.ts,
   * `responses`). Everything the app does with the answer is real.
   */
  | { respond: { url: string; with: string } };

/** Who is on screen in a journey film. */
export type Persona = "studio" | "couple" | "crew";

/**
 * How a journey film frames a step:
 *   studio  the studio's desktop, full width
 *   phone   one phone, centred, with a caption beside it ("What Ella sees")
 *   split   the studio on the left and a phone on the right, both live —
 *           for cause and effect, like a couple signing and the Booking tab ticking
 *   card    a title card, full frame
 */
export type Layout = "studio" | "phone" | "split" | "card";

/** The six marks on the timeline bar along the bottom of a journey film. */
export const RIBBON_STAGES = ["Inquiry", "Booked", "Planning", "Wedding", "Gallery", "Closed"] as const;
export type RibbonStage = (typeof RIBBON_STAGES)[number];

export type Step = {
  /** Starts a chapter in the player, titled this. */
  chapter?: string;
  /** What the narrator says while this step's actions run. Omit for a silent step. */
  say?: string;
  do: Action[];
  /** Extra breath after the narration, in ms (default 700). */
  pauseAfterMs?: number;
  /** Take the poster frame from this step. */
  poster?: boolean;
  /** Journey films: whose screen the actions run on (default: the last step's, then studio). */
  on?: Persona;
  /** Journey films: how the step is framed (default: studio for the studio, phone otherwise). */
  layout?: Layout;
  /** Journey films: the phone's caption — "What Ella sees" — and a line under it. */
  caption?: { title: string; detail?: string; eyebrow?: string };
  /**
   * Journey films: where the timeline bar's marker sits from this step on.
   * `at` is a position from 0 (inquiry) to 1 (closed); `label` is what it says.
   */
  when?: { at: number; label: string };
};

export type HowToScript = {
  /** Matches the explainer id in features/help/explainers.ts. */
  id: string;
  title: string;
  /** Who is signed in, and at what size. */
  /** A seeded role ("owner", "client", "crew"), or any seeded account's email. */
  start: { as: "owner" | "client" | "crew" | `${string}@studiohub.test`; viewport: "desktop" | "phone" };
  /**
   * A journey film: several people, each signed in on their own screen, all
   * recorded at once and framed step by step (lib/compose.ts). The studio is
   * a desktop; the couple and crew are phones. "guest" is someone not signed
   * in — a couple on the studio's website before they have an account.
   */
  cast?: Partial<Record<Persona, `${string}@studiohub.test` | "owner" | "client" | "crew" | "guest">>;
  /** A journey film that isn't a chapter: the journey snapshot it starts from (e.g. "journey-6"). */
  from?: string;
  /** A journey film: story beats run before the first frame (scripts/how-to/journey/story.ts). */
  before?: string[];
  steps: Step[];
};

export function defineHowTo(script: HowToScript): HowToScript {
  return script;
}
