/**
 * Plain-English rendering for AI command failures.
 *
 * Design rule: the UI never shows raw validation output, provider names, or
 * error dumps. Known short codes map to friendly copy; anything unrecognized
 * (long text, JSON, stack fragments) collapses to a calm generic message.
 */

const FRIENDLY_BY_CODE: Record<string, string> = {
  AI_OUTPUT_INVALID:
    "The draft didn't pass our checks, so nothing was saved. Try again — a fresh attempt usually works.",
  AI_SCHEDULE_FAILED: "We couldn't draft this schedule. Try again.",
  AI_QUOTA_EXCEEDED:
    "Your workspace has used its included AI drafts for this period. Review your plan to add more.",
  ENTITLEMENT_EXCEEDED:
    "Your workspace has used its included AI drafts for this period. Review your plan to add more.",
  INVALID_REQUEST:
    "Something about this request didn't look right. Refresh and try again.",
  INVALID_COVERAGE_RANGE: "Coverage must end after it starts.",
  FORBIDDEN: "You don't have permission to do this for the selected project.",
  METHOD_NOT_ALLOWED: "Something about this request didn't look right. Refresh and try again.",
  VERTEX_AI_SCHEDULE_NOT_CONFIGURED:
    "AI drafting isn't switched on for this workspace yet.",
  VERTEX_AI_COPILOT_NOT_CONFIGURED:
    "The assistant isn't switched on for this workspace yet.",
  VERTEX_AI_EMPTY_OUTPUT: "We couldn't draft this. Try again.",
  GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE: "We couldn't draft this. Try again.",
};

const PREFIX_FALLBACKS: Array<[RegExp, string]> = [
  [/^VERTEX_AI_/, "We couldn't draft this. Try again."],
  [/^AI_/, "We couldn't draft this. Try again."],
];

/** True when a message is safe, human-authored copy rather than a code or dump. */
const looksHumanWritten = (message: string) =>
  message.length > 0 &&
  message.length <= 200 &&
  !message.includes("{") &&
  !message.includes("[") &&
  !/^[A-Z0-9_:.]+$/.test(message) &&
  /[a-z]/.test(message);

export function friendlyAiError(
  caught: unknown,
  fallback = "We couldn't draft this. Try again.",
): string {
  const message = caught instanceof Error ? caught.message : String(caught ?? "");
  const code = message.split(":")[0]?.trim() ?? "";
  if (FRIENDLY_BY_CODE[code]) return FRIENDLY_BY_CODE[code];
  for (const [pattern, copy] of PREFIX_FALLBACKS)
    if (pattern.test(code)) return copy;
  if (looksHumanWritten(message)) return message;
  return fallback;
}
