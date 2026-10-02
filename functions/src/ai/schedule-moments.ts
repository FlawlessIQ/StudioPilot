/**
 * The standard moments of a wedding day, for the AI draft.
 *
 * features/schedules/standard-moments.ts is the source of truth — the same
 * list is offered in the editor as one-tap "Add a moment" chips. functions/ is
 * a separate package with no "@/features" path; tests/run-of-show-order.test.ts
 * compares the two and fails on drift.
 *
 * GR Productions (2026-10-01): drafts came back missing moments every wedding
 * has, and out of order. Naming them, in order, gives the model a spine to
 * place the couple's own answers on.
 */

import { jobKindOf } from "../job-kinds/job-kinds.js";

export const WEDDING_STANDARD_MOMENTS: ReadonlyArray<{ title: string; minutes: number }> = [
  { title: "Details", minutes: 30 },
  { title: "Getting into the dress", minutes: 30 },
  { title: "First look", minutes: 20 },
  { title: "Ceremony", minutes: 30 },
  { title: "Family and bridal party photos", minutes: 30 },
  { title: "Couple portraits", minutes: 30 },
  { title: "Cocktail hour", minutes: 60 },
  { title: "Reception", minutes: 30 },
  { title: "Dinner", minutes: 60 },
  { title: "Cake cutting", minutes: 15 },
];

/** Whether the job is a wedding, by its kind (job-kinds.ts). Unknown is "other" now, not a wedding. */
export function isWeddingEventType(project: unknown): boolean {
  if (typeof project === "string") return jobKindOf({ eventType: project }) === "wedding";
  return jobKindOf(project) === "wedding";
}

/**
 * The instruction that goes with them. Only for a wedding: a corporate shoot
 * has no first look.
 */
export function standardMomentsInstruction(isWedding: boolean): string {
  if (!isWedding) return "";
  const list = WEDDING_STANDARD_MOMENTS.map(
    (moment) => `${moment.title} (about ${moment.minutes} min)`,
  ).join(", ");
  return (
    " Standard moments: for a wedding, include each of these that fits inside the coverage window, as its own item, " +
    `using these titles and in this order unless the couple's answers or a timing rule say otherwise: ${list}. ` +
    "Cocktail hour and dinner are spans with a start and an end. Include a first look only if the couple have not said no to one. " +
    "Skip a moment that falls outside coverage rather than squeezing it in, and cite an assumption for any time not grounded in a supplied fact. " +
    "Return items in start-time order."
  );
}

/**
 * The usual moments of a corporate event or a sports day — the same lists the
 * editor offers (features/schedules/standard-moments.ts, KIND_STANDARD_MOMENTS).
 */
export const KIND_STANDARD_MOMENTS: Readonly<Partial<Record<string, ReadonlyArray<{ title: string; minutes: number }>>>> = {
  corporate: [
    { title: "Guest arrivals and registration", minutes: 30 },
    { title: "Keynote", minutes: 45 },
    { title: "Breakout sessions", minutes: 60 },
    { title: "Headshot station", minutes: 60 },
    { title: "Awards", minutes: 30 },
    { title: "Networking reception", minutes: 60 },
  ],
  sports: [
    { title: "Warm-ups", minutes: 30 },
    { title: "Team photo", minutes: 15 },
    { title: "Individual photos", minutes: 45 },
    { title: "Game play", minutes: 90 },
    { title: "Awards and celebrations", minutes: 20 },
  ],
};

/** The moments instruction for any job: the wedding spine, a kind's list, or nothing. */
export function momentsInstructionFor(project: unknown): string {
  if (isWeddingEventType(project)) return standardMomentsInstruction(true);
  const moments = KIND_STANDARD_MOMENTS[jobKindOf(project)];
  if (!moments?.length) return "";
  const list = moments.map((moment) => `${moment.title} (about ${moment.minutes} min)`).join(", ");
  return (
    ` Usual moments for this kind of job: where the client's answers or a timing rule support it, include these as their own items: ${list}. ` +
    "Leave out any the answers do not support, never invent a time without citing it as an assumption, and never add wedding moments. " +
    "Return items in start-time order."
  );
}
