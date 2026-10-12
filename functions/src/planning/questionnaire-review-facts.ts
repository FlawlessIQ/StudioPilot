import { twelveHourClock } from "../ai/clock-words.js";
import { EXTENSION_PLAN_LABELS, extensionPlanOf } from "../trades/extensions.js";
import { FACT_DESCRIPTIONS, type FactKey, type JobFactSheet } from "./job-facts.js";

/**
 * What Cue reads beside a client's planning form when it flags what is
 * missing and drafts the follow-up (operations/ai-pdf.ts, questionnaire
 * analysis).
 *
 * It was given the form and five project fields, so it asked for what the
 * job already settled. Priya Shah's party list line said "clip-in
 * extensions", and Cue asked what color, length or brand, though the trial
 * card already said "Buying them" with "#4 dark brown, 20 inches" (Jess
 * Styles Bridal, prod walk 2026-10-12). Now it is also given:
 *
 *   - the job's fact sheet (job-facts.ts) — the booking, the inquiry, the run
 *     of show — limited to what a planning form might ask again: never the
 *     client's email, phone, billing address, budget or how they found the
 *     studio, which no planning flag needs;
 *   - what the trial settled (projects/{id}.trialNotes, crew/commands.ts
 *     setTrialNotes): the look, the products, the extensions and their
 *     color match.
 *
 * A time field's value, and a booked time ("ceremony_time"), reaches the
 * model in 12-hour form (clock-words.ts), so the flags it writes from them
 * read "7:30 AM", not "07:30". Everything else goes as it was written: a
 * reading's "John 15:12" is not 3:12 PM, and the model, told to write 12-hour
 * times (ai/language.ts TWELVE_HOUR_PART), reads a typed "Ends 23:00" in
 * context where a pattern cannot.
 *
 * Pure.
 */

/** The facts a planning form may ask again. */
const SETTLED_FACT_KEYS: readonly FactKey[] = [
  "event_date",
  "event_type",
  "venue_name",
  "venue_address",
  "venue_city",
  "ceremony_time",
  "ready_by_time",
  "guest_count",
  "partner_one_name",
  "partner_two_name",
  "couple_names",
  "venue_contact",
  "planner",
  "videographer",
  "florist",
  "dj",
  "band",
  "caterer",
  "hair_makeup",
];

/** Facts held as a 24-hour "HH:MM" (job-facts.ts `clockTime`). */
const CLOCK_FACTS: ReadonlySet<FactKey> = new Set(["ceremony_time", "ready_by_time"]);

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * A form answer as a person reads it, for the model: a time question's
 * "07:30" is "7:30 AM". Any other answer goes as the client wrote it.
 */
export function answerForPeople(type: string, value: unknown): unknown {
  return type === "time" && typeof value === "string" ? twelveHourClock(value) : value;
}

export type SettledFact = { fact: string; value: string };

/** The job's settled facts, in words: "the time the ceremony starts" — "4:00 PM". */
export function settledJobFacts(sheet: JobFactSheet | null): SettledFact[] {
  if (!sheet) return [];
  return SETTLED_FACT_KEYS.flatMap((key) => {
    const value = text(sheet.facts[key]?.value);
    if (!value) return [];
    return [{ fact: FACT_DESCRIPTIONS[key], value: CLOCK_FACTS.has(key) ? twelveHourClock(value) : value }];
  });
}

/** What the trial settled, by name; null when nothing was noted. */
export function settledAtTrial(trialNotes: unknown): Record<string, string> | null {
  const notes = trialNotes && typeof trialNotes === "object" ? (trialNotes as Record<string, unknown>) : {};
  const plan = extensionPlanOf(notes.extensions);
  const settled: Record<string, string> = {};
  if (text(notes.look)) settled.look = text(notes.look);
  if (text(notes.products)) settled.productsUsed = text(notes.products);
  if (plan) settled.extensions = EXTENSION_PLAN_LABELS[plan];
  // A color match belongs to extensions being worn: "No extensions" leaves none.
  if (plan !== "none" && text(notes.colorMatch)) settled.extensionsColorMatch = text(notes.colorMatch);
  return Object.keys(settled).length ? settled : null;
}

/**
 * The instruction that goes with them. Without it the model reads the
 * settled facts as more context and still asks the client to confirm them.
 */
export const SETTLED_FACTS_INSTRUCTION =
  " settledJobFacts and settledAtTrial are what the studio already knows about this job, from the booking, the inquiry and the trial. Never list any of it as missing, never ask the client for it again, and never question a detail it already answers (an extension color or length the trial noted, a ready-by time the booking holds). Flag a form answer that contradicts it as a possible contradiction.";
