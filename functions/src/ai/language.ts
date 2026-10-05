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
