/**
 * StudioCue's studios and their clients are American, so everything a model
 * writes for them is American English.
 *
 * The product's own copy was swept to US English on 2026-10-05 after the
 * reference studio read "Approving emails this to … straight away" and
 * laughed. The screens are guarded by tests/us-english-copy.test.ts; nothing
 * guards what a model writes except this line, so every prompt that produces
 * prose a person reads carries it as an extra system-instruction part.
 * Extraction prompts (which must keep the source's own words) do not.
 */
export const US_ENGLISH_INSTRUCTION =
  "Write in American English: American spelling (color, organize, canceled, favorite) and American wording (right away, not straight away; check the box, not tick; fill out a form; on the calendar; two weeks, not a fortnight).";

/** The instruction as a Gemini `systemInstruction` part. */
export const US_ENGLISH_PART = { text: US_ENGLISH_INSTRUCTION };

/**
 * Clock times the American way, for a prompt whose prose names them.
 *
 * Not part of US_ENGLISH_PART: some of the prompts that carry that line
 * return machine times ("HH:MM" fields a schedule is built from), and must
 * keep them. This one goes only where a time is written for a person to
 * read — Cue's planning flags said "earliest setup time of 07:30" (Jess
 * Styles Bridal, prod walk 2026-10-12).
 */
export const TWELVE_HOUR_INSTRUCTION =
  "Write every clock time in 12-hour form with AM or PM, as Americans do (7:30 AM, 12:30 PM, 4:00 PM), never 24-hour (07:30, 16:00).";

export const TWELVE_HOUR_PART = { text: TWELVE_HOUR_INSTRUCTION };
