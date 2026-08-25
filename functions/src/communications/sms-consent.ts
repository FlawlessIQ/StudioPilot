/**
 * SMS consent — mirror.
 *
 * `features/messaging/sms-consent.ts` is the source of truth and carries the
 * unit tests (`npm test`); functions/ is a separate package and cannot import
 * from features/. Change the features/ copy first, then bring this in line.
 *
 * The zod schemas stay on the features/ side — the server needs the decisions,
 * not the validators.
 */

export type SmsConsentState = "unknown" | "granted" | "revoked";

export type SmsConsentSource =
  | "portal_checkbox"
  | "booking_form"
  | "studio_recorded"
  | "sms_reply";

export type SmsConsent = {
  state: SmsConsentState;
  decidedAt: string | null;
  source: SmsConsentSource | null;
  recordedBy: string | null;
  disclosureText: string | null;
};

export const unknownSmsConsent: SmsConsent = {
  state: "unknown",
  decidedAt: null,
  source: null,
  recordedBy: null,
  disclosureText: null,
};

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

export function consentIntentOf(body: string): "opt_out" | "opt_in" | "none" {
  const word = firstWord(body);
  if (!word) return "none";
  const rest = body.trim().split(/\s+/).length;
  if (optOutKeywords.has(word)) return rest <= 2 ? "opt_out" : "none";
  if (optInKeywords.has(word)) return rest <= 2 ? "opt_in" : "none";
  return "none";
}

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
  return { allowed: false, reason: "This client has not agreed to texts yet." };
}

export function optOutAcknowledgement(studioName: string): string {
  return `${studioName}: you will not receive further texts from us. Reply START to opt back in.`;
}
