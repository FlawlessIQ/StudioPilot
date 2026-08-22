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
  FUNCTION_ACCESS_DENIED:
    "The studio server refused this request — usually a deploy still settling. Try again in a minute; if it keeps happening, contact support.",
  FUNCTION_UPSTREAM_UNAVAILABLE:
    "The studio server didn't answer properly. Try again in a minute; if it keeps happening, contact support.",
  VERTEX_AI_SCHEDULE_NOT_CONFIGURED:
    "AI drafting isn't switched on for this workspace yet.",
  VERTEX_AI_COPILOT_NOT_CONFIGURED:
    "The assistant isn't switched on for this workspace yet.",
  VERTEX_AI_EMPTY_OUTPUT: "We couldn't draft this. Try again.",
  GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE: "We couldn't draft this. Try again.",

  /**
   * Capability resolution refusing to guess.
   *
   * These used to be silent: with nothing connected, signing fell back to
   * DocuSign and queued a request against an account that did not exist,
   * so the studio learned about it from a failed provider job rather than
   * from the button they pressed. Each of these names the actual fix.
   */
  SIGNING_NO_CONNECTED_PROVIDER:
    "No signing app is connected, so the agreement can't go out for signature. Connect DocuSign or Dropbox Sign in Studio settings, then try again.",
  SIGNING_AMBIGUOUS_MULTIPLE_PROVIDERS:
    "Both DocuSign and Dropbox Sign are connected, so StudioCue doesn't know which should send the agreement. Choose one in Studio settings.",
  SIGNING_SELECTED_PROVIDER_NOT_CONNECTED:
    "The signing app you chose isn't connected any more. Reconnect it in Studio settings, or choose another.",
  INVOICING_NO_CONNECTED_PROVIDER:
    "No invoicing app is connected, so the retainer invoice can't be raised. Connect QuickBooks or Stripe in Studio settings, then try again.",
  INVOICING_AMBIGUOUS_MULTIPLE_PROVIDERS:
    "Both QuickBooks and Stripe are connected, so StudioCue doesn't know which should raise the invoice. Choose one in Studio settings.",
  INVOICING_SELECTED_PROVIDER_NOT_CONNECTED:
    "The invoicing app you chose isn't connected any more. Reconnect it in Studio settings, or choose another.",
};

/**
 * Infrastructure failures whose raw text reads as prose and therefore slips
 * past looksHumanWritten. "Firebase client configuration is incomplete:
 * apiKey, authDomain, projectId…" is a deployment problem, not something a
 * photographer can act on.
 */
const FRIENDLY_BY_PHRASE: Array<[RegExp, string]> = [
  [
    /firebase client configuration is incomplete/i,
    "This workspace isn't fully configured yet, so live records can't load. Your studio administrator can finish the setup.",
  ],
  [
    /missing or insufficient permissions/i,
    "You don't have access to these records. Ask your studio owner to check your role.",
  ],
  [
    /failed to fetch|network ?error|load failed/i,
    "We couldn't reach the server. Check your connection and try again.",
  ],
  // Firestore security-rules evaluation dumps ("evaluation error at L386:22
  // for 'get' … Null value error.") read as prose to looksHumanWritten but
  // are plumbing, never something a photographer can act on.
  [
    /evaluation error at L\d+|null value error/i,
    "Some records couldn't be loaded. Refresh to try again — if this keeps happening, contact support.",
  ],
];

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
  for (const [pattern, copy] of FRIENDLY_BY_PHRASE)
    if (pattern.test(message)) return copy;
  for (const [pattern, copy] of PREFIX_FALLBACKS)
    if (pattern.test(code)) return copy;
  if (looksHumanWritten(message)) return message;
  return fallback;
}

/**
 * Same rules, general name. Non-AI surfaces (booking evidence, records
 * panels) show these notices too and must not leak plumbing either.
 */
export function friendlyError(
  caught: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  return friendlyAiError(caught, fallback);
}
