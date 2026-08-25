import { z } from "zod";

/**
 * SMS consent.
 *
 * Text is the channel photographers actually use with couples, and the one with
 * real legal exposure. Under US TCPA rules a business needs prior express
 * consent before texting, must honour an opt-out immediately, and has to be able
 * to show when and how consent was given. `docs/production-readiness.md` already
 * gates SMS behind "Twilio credentials, sender registration, consent".
 *
 * So consent is a record, not a flag: what was agreed, when, through what, and
 * by whom. A boolean cannot answer a complaint.
 *
 * Deterministic and browser-safe. Mirrored by
 * functions/src/communications/sms-consent.ts; this copy has the tests and is
 * the source of truth.
 */

export const smsConsentStateSchema = z.enum([
  /** Never asked. The default, and not a licence to send. */
  "unknown",
  /** Explicitly agreed. */
  "granted",
  /** Explicitly refused, or opted out by replying STOP. */
  "revoked",
]);
export type SmsConsentState = z.infer<typeof smsConsentStateSchema>;

export const smsConsentSourceSchema = z.enum([
  "portal_checkbox",
  "booking_form",
  "studio_recorded",
  "sms_reply",
]);
export type SmsConsentSource = z.infer<typeof smsConsentSourceSchema>;

export const smsConsentSchema = z.object({
  state: smsConsentStateSchema,
  /** ISO timestamp of the most recent change. Null only while unknown. */
  decidedAt: z.string().nullable(),
  source: smsConsentSourceSchema.nullable(),
  /** Who recorded it — a user id, or the phone number for an SMS reply. */
  recordedBy: z.string().nullable(),
  /** The exact wording agreed to, kept verbatim for evidence. */
  disclosureText: z.string().nullable(),
});
export type SmsConsent = z.infer<typeof smsConsentSchema>;

export const unknownSmsConsent: SmsConsent = {
  state: "unknown",
  decidedAt: null,
  source: null,
  recordedBy: null,
  disclosureText: null,
};

/**
 * Carrier-mandated opt-out keywords. These must work regardless of casing,
 * surrounding punctuation, or a trailing "please" — a person typing "Stop."
 * has opted out, and treating that as a normal message is the failure that
 * draws a complaint.
 */
const optOutKeywords = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "optout",
  "opt-out",
]);

/** The matching opt-in keywords, so someone who stopped can start again. */
const optInKeywords = new Set(["start", "unstop", "yes", "optin", "opt-in"]);

function firstWord(body: string): string {
  return (
    body
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .split(/\s+/)[0] ?? ""
  );
}

/**
 * What an inbound text means for consent.
 *
 * Only the first word is considered. "Stop by the church at 2" is not an opt-out
 * and must not be treated as one, while "STOP" on its own — or "stop please" —
 * is. Anything else leaves consent unchanged.
 */
export function consentIntentOf(body: string): "opt_out" | "opt_in" | "none" {
  const word = firstWord(body);
  if (!word) return "none";
  const rest = body.trim().split(/\s+/).length;
  // A keyword buried in a sentence is prose. Carriers only require the keyword
  // alone, and "cancel the second photographer" plainly is not an opt-out.
  if (optOutKeywords.has(word)) return rest <= 2 ? "opt_out" : "none";
  if (optInKeywords.has(word)) return rest <= 2 ? "opt_in" : "none";
  return "none";
}

/** Fold an inbound text's consent intent into the stored record. */
export function applyConsentIntent(
  current: SmsConsent,
  body: string,
  at: string,
  fromNumber: string,
): SmsConsent {
  const intent = consentIntentOf(body);
  if (intent === "none") return current;
  return {
    state: intent === "opt_out" ? "revoked" : "granted",
    decidedAt: at,
    source: "sms_reply",
    recordedBy: fromNumber,
    disclosureText: current.disclosureText,
  };
}

/**
 * Whether a text may be sent.
 *
 * Fails closed on unknown: never having asked is not permission. Returns the
 * reason as well as the answer, so the studio is told why a channel is
 * unavailable rather than finding the button quietly inert.
 */
export function canSendSms(
  consent: SmsConsent | null | undefined,
  phone: string | null | undefined,
): { allowed: boolean; reason: string | null } {
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    return {
      allowed: false,
      reason: "No mobile number on file in international format.",
    };
  }
  const state = consent?.state ?? "unknown";
  if (state === "granted") return { allowed: true, reason: null };
  if (state === "revoked") {
    return {
      allowed: false,
      reason: "This client asked to stop receiving texts.",
    };
  }
  return {
    allowed: false,
    reason: "This client has not agreed to texts yet.",
  };
}

/**
 * The reply a carrier expects to an opt-out, and the only message that may be
 * sent to someone who has just revoked consent.
 */
export function optOutAcknowledgement(studioName: string): string {
  return `${studioName}: you will not receive further texts from us. Reply START to opt back in.`;
}
