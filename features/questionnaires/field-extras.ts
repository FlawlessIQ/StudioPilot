/**
 * Two things a question can offer the couple besides a box to fill.
 *
 * "TBD" — GR Productions (2026-10-02): at the event-details stage a couple
 * often hasn't decided where the groom gets ready or when cocktails end, and a
 * required question with no honest answer gets a made-up one. A question that
 * allows it takes the literal answer "TBD": it counts as answered, prints as
 * "To be confirmed" in the agreement's Schedule A, and is never copied forward
 * into a later form — the final schedule asks again.
 *
 * Suggested times — GR's final schedule is written as rules ("details with the
 * bride: 30 minutes before prep ends", "cocktail hour: auto fill from
 * details"). A question can name the time it follows and by how many minutes;
 * the couple sees the suggestion and keeps it or changes it.
 *
 * Pure. Duplicated at functions/src/planning/field-extras.ts; the test fails
 * on drift.
 */

export const TBD = "TBD";

/** Whether an answer is the couple's "not decided yet". */
export function isTbd(value: unknown): boolean {
  return typeof value === "string" && /^\s*(tbd|tbc|to be (decided|determined|confirmed))\s*$/i.test(value);
}

/** Question types a "TBD" answer makes sense for; the template editor offers it on these. */
export const TBD_TYPES: readonly string[] = ["text", "long_text", "time", "address", "contact"];

/**
 * A question asking for a time: a time question, or a text one whose label
 * says "time" ("Ceremony Times", "Photo/Video Start and End Time" — GR's
 * imported form asks its times as text).
 */
export function isTimeQuestion(field: { type?: unknown; label?: unknown }): boolean {
  const type = typeof field.type === "string" ? field.type : "text";
  if (type === "time") return true;
  return (type === "text" || type === "long_text") && /\btimes?\b/i.test(String(field.label ?? ""));
}

/**
 * Whether the couple can answer "not decided yet".
 *
 * Every time question can unless the studio turned it off. GR Productions
 * (2026-10-05), when the inquiry link first asked their event form: "Let TBD
 * be an option for everything. On times." A per-question tick no studio had
 * ticked left a couple who hadn't fixed their hours unable to send the form,
 * and so unable to book a call. Anything else allows it only when ticked.
 */
export function allowsTbd(field: { type?: unknown; label?: unknown; allowTbd?: unknown }): boolean {
  if (field.allowTbd === true) return true;
  if (field.allowTbd === false) return false;
  return isTimeQuestion(field);
}

export type SuggestedFrom = { fieldId: string; minutes: number };

/** A field's `suggestedFrom`, when it is well formed. */
export function suggestedFromOf(value: unknown): SuggestedFrom | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const fieldId = typeof row.fieldId === "string" ? row.fieldId.trim() : "";
  const minutes = Number(row.minutes ?? 0);
  if (!fieldId || !Number.isInteger(minutes) || Math.abs(minutes) > 720) return null;
  return { fieldId, minutes };
}

/** "16:30" moved by `minutes`, within the day; anything else → null. */
export function shiftClock(value: unknown, minutes: number): string | null {
  const match = typeof value === "string" ? /^(\d{2}):(\d{2})/.exec(value) : null;
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
  if (total < 0 || total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The time a field suggests from the answers so far, or null. */
export function suggestedTime(field: { suggestedFrom?: unknown }, answers: Record<string, unknown>): string | null {
  const from = suggestedFromOf(field.suggestedFrom);
  return from ? shiftClock(answers[from.fieldId], from.minutes) : null;
}
