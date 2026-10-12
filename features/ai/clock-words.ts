/**
 * Clock times as an American reads them: 7:30 AM, never 07:30.
 *
 * A form's time field saves a 24-hour "HH:MM", and a model handed one copies
 * it: Cue's planning flags on Priya Shah's party list read "earliest setup
 * time of 07:30 and ready-by time of 12:30" (Jess Styles Bridal, prod walk
 * 2026-10-12). So a time field's value is put in 12-hour form before it
 * reaches the model (functions/src/planning/questionnaire-review-facts.ts),
 * and whatever comes back, and every card's "Check" note (check-note.ts),
 * goes through `twelveHourTimes`. Free text reaches the model as written: a
 * pattern cannot tell "John 15:12" from a time, and the model, told to write
 * 12-hour times, can.
 *
 * functions/src/ai/clock-words.ts mirrors everything below the marker;
 * tests/cue-planning-words.test.ts compares the two. Pure, no imports.
 */
// ── mirrored below ──

/**
 * A known 24-hour time — a time field's "07:30", "16:00" — as "7:30 AM",
 * "4:00 PM". Anything else comes back as it was.
 */
export function twelveHourClock(value: string): string {
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2]!;
  if (hour > 23 || Number(minute) > 59) return value;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * What makes the "12:10" after it a reference rather than a time: a
 * capitalized word and a space, as a reading's book and chapter are written
 * ("John 15:12", "1 Corinthians 13:13", "Rom. 12:10"), or a ratio or a score.
 */
const REFERENCE_BEFORE = /(?:\b[A-Z][A-Za-z]*\.?|\b(?:ratios?|scores?|verses?|chapters?)(?:\s+(?:of|is|was))?)\s+$/;

/**
 * Every 24-hour time in a piece of text, in 12-hour form.
 *
 * Only a time that cannot be a 12-hour one is changed: an hour written with a
 * leading zero ("07:30"), an hour past 12 ("16:00"), or noon's "12:30". A
 * bare "10:30" or "7:30" is left as written, because a person who wrote
 * "the music ends at 11:00" meant the evening, and making it "11:00 AM"
 * would be wrong where leaving it is only short. A time that already says AM
 * or PM is left alone, and so is what only looks like one: 16:9, 1:07:30, a
 * timestamp's seconds, and an hour from 12 to 23 written straight after a
 * capitalized word or a ratio, which is a reading ("John 15:12", "Romans
 * 12:10") or a ratio ("16:10") at least as often as a time. That leaves
 * "Ceremony 16:00" too, which is short where "John 3:12 PM" would be wrong.
 * A reference never has a leading zero, so "Priya 07:30" still changes.
 */
export function twelveHourTimes(text: string): string {
  return text.replace(
    /(?<![\d:.])(\d{2}):(\d{2})(?![\d]|:\d)(?!\s?(?:[ap]\.?m\b|[ap]\.m\.))/gi,
    (whole: string, hours: string, minutes: string, offset: number, all: string) => {
      const hour = Number(hours);
      if (hour > 23 || Number(minutes) > 59) return whole;
      if (!hours.startsWith("0")) {
        if (hour < 12) return whole;
        if (REFERENCE_BEFORE.test(all.slice(0, offset))) return whole;
      }
      return twelveHourClock(whole);
    },
  );
}
