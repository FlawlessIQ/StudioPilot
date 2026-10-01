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

/** Whether the job is a wedding. Unknown reads as one, as the draft defaults. */
export function isWeddingEventType(value: unknown): boolean {
  const type = typeof value === "string" ? value.trim() : "";
  return !type || /wedding|elopement/i.test(type);
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
