/**
 * "How your first reply should go" — the words the settings page needs.
 *
 * The limit is the server's (FIRST_REPLY_INSTRUCTIONS_MAX in
 * functions/src/ai/studio-voice.ts, which cuts to it whatever the browser
 * sends); tests/first-reply-voice.test.ts keeps the two equal.
 */
export const FIRST_REPLY_INSTRUCTIONS_LIMIT = 1000;

export const FIRST_REPLY_PLACEHOLDER =
  "e.g. Always thank them for thinking of us, mention we're a husband-and-wife team, and invite them to call — we'd rather talk than email.";
