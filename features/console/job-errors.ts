/**
 * A failed job's error, in words an operator can act on (docs/console.md,
 * "Jobs").
 *
 * The dead-letter list showed `ZOOM_NOT_CONNECTED · ZOOM_NOT_CONNECTED` beside
 * a Rerun button. Rerunning that does nothing: the studio disconnected Zoom,
 * and the job fails again until they reconnect. The Console groups failures by
 * cause and says, for each cause, what fixes it and whether a rerun can.
 *
 * Pure. tests/console-display.test.ts pins the rules.
 */

export type JobErrorAdvice = {
  /** One line naming the cause. */
  cause: string;
  /** What to do about it. */
  advice: string;
  /** Running the job again, unchanged, can succeed. */
  rerunHelps: boolean;
  /** The fix is in the studio's hands, so emailing them is the action. */
  studioFixes: boolean;
  /** The fix is ours: configuration or a bug. */
  oursToFix: boolean;
};

const PROVIDERS: Array<[RegExp, string]> = [
  [/^GOOGLE_CALENDAR|^CALENDAR_/, "Google Calendar"],
  [/^ZOOM/, "Zoom"],
  [/^DROPBOX_SIGN/, "Dropbox Sign"],
  [/^DOCUSIGN/, "DocuSign"],
  [/^QUICKBOOKS/, "QuickBooks"],
  [/^STRIPE/, "Stripe"],
  [/^SENDGRID/, "SendGrid"],
  [/^VERTEX_AI|^AI_/, "the AI model"],
  [/^SECRET_MANAGER/, "Secret Manager"],
];

export function providerFromCode(code: string): string | null {
  return PROVIDERS.find(([pattern]) => pattern.test(code))?.[1] ?? null;
}

/** The HTTP status a provider error carries, as in `DROPBOX_SIGN_CREATE_FAILED:402:PROVIDER_ERROR`. */
export function statusFromMessage(message: string): number | null {
  const match = message.match(/:(\d{3})(?::|$)/);
  return match ? Number(match[1]) : null;
}

export function explainJobError(code: string | null | undefined, message: string | null | undefined): JobErrorAdvice {
  const key = (code ?? "").trim() || "UNKNOWN";
  const text = message ?? "";
  const provider = providerFromCode(key) ?? "The provider";
  const status = statusFromMessage(text);

  if (/_NOT_CONNECTED$/.test(key) || key === "PROVIDER_NOT_CONNECTED")
    return {
      cause: `${provider === "The provider" ? "An integration" : provider} isn't connected for this studio.`,
      advice: "The job fails until the studio connects it again. Ask them to reconnect in Integrations, then rerun.",
      rerunHelps: false,
      studioFixes: true,
      oursToFix: false,
    };
  if (status === 401 || status === 403)
    return {
      cause: `${provider} rejected the studio's connection.`,
      advice: "Their sign-in to the provider has expired or been revoked. Ask them to reconnect in Integrations, then rerun.",
      rerunHelps: false,
      studioFixes: true,
      oursToFix: false,
    };
  if (status === 402)
    return {
      cause: `${provider} refused with "payment required".`,
      advice: "The account behind the request has no plan or credit for this call. Check that account's billing, then rerun.",
      rerunHelps: false,
      studioFixes: false,
      oursToFix: true,
    };
  if (status === 429)
    return {
      cause: `${provider} was rate limiting.`,
      advice: "A rerun usually succeeds once the limit resets.",
      rerunHelps: true,
      studioFixes: false,
      oursToFix: false,
    };
  if ((status !== null && status >= 500) || /TIMEOUT|FETCH_FAILED|UNAVAILABLE$/.test(key))
    return {
      cause: `${provider} was unavailable or timed out.`,
      advice: "Usually temporary. Rerun it.",
      rerunHelps: true,
      studioFixes: false,
      oursToFix: false,
    };
  if (/_NOT_CONFIGURED$|^CREDENTIAL_UNAVAILABLE$|_IDENTITY_UNAVAILABLE$|^GOOGLE_CLOUD_PROJECT_REQUIRED$|^SECRET_MANAGER_/.test(key))
    return {
      cause: "StudioCue's own configuration is missing something this job needs.",
      advice: "A secret or environment setting isn't present on the function. Fix the configuration and redeploy, then rerun.",
      rerunHelps: false,
      studioFixes: false,
      oursToFix: true,
    };
  if (/^UNSUPPORTED_|_GUARD_MISSING$|^TENANT_MISMATCH$/.test(key))
    return {
      cause: "The job reached code that doesn't know how to run it.",
      advice: "This is a StudioCue bug, not a provider problem. Rerunning repeats it.",
      rerunHelps: false,
      studioFixes: false,
      oursToFix: true,
    };
  if (key === "IMPORT_SOURCE_MISSING")
    return {
      cause: "A file the studio imported never finished uploading.",
      advice: "The import has nothing to read. Ask the studio to upload that file again; dismiss this one.",
      rerunHelps: false,
      studioFixes: true,
      oursToFix: false,
    };
  if (key === "DROPBOX_PROJECT_ROOT_MISSING")
    return {
      cause: "This job has no Dropbox folder.",
      advice: "Folders are made when a job is booked, so Dropbox probably wasn't connected then. A rerun fails the same way; dismiss it unless the folder should exist.",
      rerunHelps: false,
      studioFixes: false,
      oursToFix: false,
    };
  if (/_NOT_FOUND$/.test(key))
    return {
      cause: "Something the job refers to no longer exists.",
      advice: "Usually the record was deleted or archived after the job was queued. Dismiss it unless the record should still be there.",
      rerunHelps: false,
      studioFixes: false,
      oursToFix: false,
    };
  if (/RECIPIENT_MISSING$|^RECIPIENT_UNKNOWN$|_CONTACT_MISSING$/.test(key))
    return {
      cause: "There's no email address or contact to send to.",
      advice: "The studio's client record is missing contact details. Once they add them, the next send works; dismiss this one.",
      rerunHelps: false,
      studioFixes: true,
      oursToFix: false,
    };
  if (/^QUICKBOOKS_.*_MISSING$|^QUICKBOOKS_REALM/.test(key))
    return {
      cause: "The studio's QuickBooks setup is incomplete.",
      advice: "A customer, item or income account StudioCue needs isn't set in their QuickBooks. Ask them to finish it, then rerun.",
      rerunHelps: false,
      studioFixes: true,
      oursToFix: false,
    };
  if (/^VERTEX_AI_(FAILED|EMPTY_OUTPUT)$|^AI_OUTPUT_INVALID$/.test(key))
    return {
      cause: "The AI model returned nothing usable.",
      advice: "Often a one-off. Rerun it.",
      rerunHelps: true,
      studioFixes: false,
      oursToFix: false,
    };
  if (status !== null && status >= 400)
    return {
      cause: `${provider} refused the request (${status}).`,
      advice: "The same request is refused the same way. Check the message for what the provider objected to before rerunning.",
      rerunHelps: false,
      studioFixes: false,
      oursToFix: false,
    };
  return {
    cause: "A failure StudioCue doesn't have a description for yet.",
    advice: "Read the full message. Rerun if it looks temporary.",
    rerunHelps: true,
    studioFixes: false,
    oursToFix: false,
  };
}
