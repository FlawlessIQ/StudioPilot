/**
 * What a prepared draft is unsure of, as its card's "Check" note.
 *
 * `confidence.uncertainFields` holds what the AI wrote: a phrase ("exact
 * styling services for each person, timing details for the hair trial"), a
 * sentence ("No event date was given in the inquiry."), now and then a field
 * name ("event_date"). The card capitalized every word, so an inquiry reply
 * read "Check Exact Styling Services For Each Person, Timing Details For The
 * Hair Trial" (Priya Shah, Jess Styles Bridal, 2026-10-10).
 *
 * Each now reads as a sentence: a field name becomes plain words, and text
 * keeps the AI's own case after its first letter, so a name or an initialism
 * ("Priya", "DJ") is never lowered. The items follow a colon, so none has to
 * start lowercase to read on from "Check". Pure.
 */

/** One item in sentence case, without its closing punctuation. */
export function uncertainItem(value: unknown): string {
  let item = (typeof value === "string" ? value : "").trim().replace(/[\s.;,]+$/, "");
  if (!item) return "";
  // A field name: event_date, venueName. Only snake case or lower camel case:
  // a one-word name with a capital inside ("McKenzie", "DeLuca") is a name.
  if (!/\s/.test(item) && (item.includes("_") || /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(item))) {
    item = item.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
  }
  return `${item.charAt(0).toUpperCase()}${item.slice(1)}`;
}

/** "Check: Venue address; Exact styling services for each person +2", or null with nothing to check. */
export function checkNote(fields: readonly unknown[], shown = 3): string | null {
  const items = fields.map(uncertainItem).filter(Boolean);
  if (!items.length) return null;
  const more = items.length > shown ? ` +${items.length - shown}` : "";
  return `Check: ${items.slice(0, shown).join("; ")}${more}`;
}
