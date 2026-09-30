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
  | { card: { eyebrow?: string; title: string; subtitle?: string } };

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
};

export type HowToScript = {
  /** Matches the explainer id in features/help/explainers.ts. */
  id: string;
  title: string;
  /** Who is signed in, and at what size. */
  /** A seeded role ("owner", "client", "crew"), or any seeded account's email. */
  start: { as: "owner" | "client" | "crew" | `${string}@studiohub.test`; viewport: "desktop" | "phone" };
  steps: Step[];
};

export function defineHowTo(script: HowToScript): HowToScript {
  return script;
}
