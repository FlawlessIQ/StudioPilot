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
   * Booking attestations refusing for a reason worth reading.
   *
   * These carry real information and used to reach the user verbatim. The
   * sweep that routed raw exception messages through this map turned them
   * into "The payment could not be recorded", which is calm and useless: the
   * walk of 2026-08-26 hit RETAINER_INVOICE_ALREADY_EXISTS and the screen
   * gave no hint that a standing invoice was the obstacle. A collapsed
   * message is only an improvement when the code says nothing.
   */
  /**
   * Delivery and closeout refusing for a reason worth reading. Same lesson as
   * the booking codes below: the walk of 2026-08-26 pressed "Record and release
   * delivery" on a job at Shot and read only "Delivery could not be recorded",
   * when the code said exactly what was wrong.
   */
  PROJECT_NOT_IN_POST_PRODUCTION:
    "This job hasn't started post-production yet. Move it on from the job page, then record the gallery.",
  /**
   * Named from the code, not from the page. The delivery page says StudioCue
   * "checks the balance, the contract and the crew before anything reaches the
   * couple", and the gate checks none of those — it requires the backup,
   * editing and gallery-ready steps on the post-production record. Copy that
   * describes the wrong check is worse than no copy.
   */
  DELIVERY_GATE_BLOCKED:
    "The gallery isn't cleared for release yet. Backup, editing and gallery-ready all have to be ticked on this job's post-production checklist first.",
  DELIVERY_URL_MUST_USE_HTTPS:
    "The gallery link has to start with https:// so the couple's photographs are not sent over an open connection.",
  DELIVERY_DRAFT_INVALID:
    "Some of the gallery details didn't look right. Check the link, the access code and the dates.",
  PROJECT_NOT_READY_FOR_CLOSEOUT:
    "This job can't be closed out yet — the gallery, the balance or the album is still open.",
  ALBUM_STATUS_REGRESSION:
    "An album can't go backwards. Refresh to see where this one actually is.",
  ALBUM_CREATIVE_AUTHORITY_REQUIRED:
    "Only the studio owner or a lead photographer can make this album decision.",

  /**
   * Kept for older clients. Recording a payment against a standing invoice now
   * settles that invoice instead of refusing, so this should not be reached
   * from the current booking screen.
   */
  RETAINER_INVOICE_ALREADY_EXISTS:
    "This retainer is already settled. Refresh the booking page to see where the job stands.",
  RETAINER_INVOICE_NOT_FOUND:
    "That retainer invoice could not be found. Refresh the booking page and try again.",
  SIGNED_CONTRACT_REQUIRED:
    "The signed agreement comes first. Record the signature, then the retainer.",
  RETAINER_NOT_READY:
    "This job isn't waiting on a retainer yet. Refresh the booking page to see which step it is actually on.",
  RETAINER_ATTESTATION_PERMISSION_REQUIRED:
    "Only the studio owner or an admin can record a payment by hand.",
  PACKAGE_SNAPSHOT_NOT_FOUND:
    "The locked package for this job could not be found, so there is no price to record against.",
  CONTRACT_NOT_READY:
    "The accepted proposal must be ready before a contract can be sent.",
  ACCEPTED_PROPOSAL_REQUIRED:
    "The client needs to accept the proposal before the agreement can go out.",

  /**
   * Capability resolution refusing to guess.
   *
   * These used to be silent: with nothing connected, signing fell back to
   * DocuSign and queued a request against an account that did not exist,
   * so the studio learned about it from a failed provider job rather than
   * from the button they pressed. Each of these names the actual fix.
   */
  SIGNING_NO_CONNECTED_PROVIDER:
    "No signing app is connected, so the agreement can't go out for signature. Connect Dropbox Sign in Studio settings, then try again.",
  SIGNING_AMBIGUOUS_MULTIPLE_PROVIDERS:
    "More than one signing app is connected, so StudioCue doesn't know which should send the agreement. Choose one in Studio settings.",
  SIGNING_SELECTED_PROVIDER_NOT_CONNECTED:
    "The signing app you chose isn't connected any more. Reconnect it in Studio settings, or choose another.",
  INVOICING_NO_CONNECTED_PROVIDER:
    "No invoicing app is connected, so the retainer invoice can't be raised. Connect QuickBooks in Studio settings, then try again.",
  INVOICING_AMBIGUOUS_MULTIPLE_PROVIDERS:
    "More than one invoicing app is connected, so StudioCue doesn't know which should raise the invoice. Choose one in Studio settings.",
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
