/**
 * Every email a studio's clients and crew get, as the template editor lists
 * them: grouped the way a job runs, each with when it goes.
 *
 * The editor's old list was a hand-picked thirty with raw key names ("Crew
 * Reminder", "Coi Correction") and none of the agreement, payment or delivery
 * emails added since. `tests/email-template-editor.test.ts` holds this list to
 * the server's (functions/src/communications/email-templates.ts): every email
 * a client or crew member can get is here, or excluded below with the reason.
 */

import { tradeProfile, tradeVocab } from "@/features/trades/trades";

export type EmailGroup =
  | "Inquiry & consultation"
  | "Proposal & booking"
  | "Agreement"
  | "Payments"
  | "Planning"
  | "After the event"
  | "Crew"
  | "Insurance";

export type EditableEmail = {
  key: string;
  label: string;
  group: EmailGroup;
  /** When StudioCue sends it, in a phrase. */
  when: string;
};

export const EDITABLE_EMAILS: readonly EditableEmail[] = [
  { key: "inquiry_acknowledgement", group: "Inquiry & consultation", label: "Inquiry received", when: "Right after someone sends you an inquiry" },
  // Not sent by itself: the reply drafted on Today starts from it.
  { key: "inquiry_reply", group: "Inquiry & consultation", label: "Your reply to a new inquiry", when: "The reply waiting for you on Today when an inquiry arrives" },
  { key: "consultation_invitation", group: "Inquiry & consultation", label: "Book a call", when: "When you invite them to pick a consultation time" },
  { key: "consultation_confirmation", group: "Inquiry & consultation", label: "Call booked", when: "When a consultation is booked" },
  { key: "consultation_reminder", group: "Inquiry & consultation", label: "Call reminder", when: "Before their consultation" },
  { key: "consultation_rescheduled", group: "Inquiry & consultation", label: "Call moved", when: "When a consultation moves to a new time" },
  { key: "consultation_cancelled", group: "Inquiry & consultation", label: "Call canceled", when: "When a consultation is canceled" },
  { key: "package_follow_up", group: "Inquiry & consultation", label: "Package options", when: "When you send them your coverage options" },

  { key: "client_invitation", group: "Proposal & booking", label: "Portal invitation", when: "When they're invited to their client portal" },
  { key: "proposal_sent", group: "Proposal & booking", label: "Proposal", when: "When you send a proposal" },
  { key: "booking_confirmation", group: "Proposal & booking", label: "Booking confirmed", when: "When the date is booked" },
  { key: "project_cancelled", group: "Proposal & booking", label: "Booking canceled", when: "When you cancel a booking and choose to tell them" },

  { key: "contract_ready", group: "Agreement", label: "Agreement to sign", when: "When their agreement is ready to sign" },
  { key: "contract_reminder", group: "Agreement", label: "Signing reminder", when: "When the agreement is still unsigned a few days later" },
  { key: "contract_signed", group: "Agreement", label: "Signed agreement", when: "When everyone has signed — their copy" },
  { key: "contract_voided", group: "Agreement", label: "Agreement voided", when: "When an agreement is voided" },
  { key: "contract_superseded", group: "Agreement", label: "Agreement replaced", when: "When a new agreement replaces the one they had" },
  { key: "amendment_withdrawn", group: "Agreement", label: "Booking change withdrawn", when: "When you withdraw a change you'd sent them to sign" },

  { key: "retainer_invoice", group: "Payments", label: "Retainer invoice", when: "When the retainer is due" },
  { key: "final_invoice", group: "Payments", label: "Final invoice", when: "When the final balance is billed" },
  { key: "billing_address_request", group: "Payments", label: "Billing address request", when: "When there's no billing address on file before the final bill" },
  { key: "autopay_charged", group: "Payments", label: "Card charged", when: "When a saved card is charged — their receipt" },
  { key: "autopay_charge_failed", group: "Payments", label: "Card declined", when: "When a saved-card charge fails" },
  { key: "participant_receipt", group: "Payments", label: "Group event receipt", when: "When someone pays for a group event" },

  { key: "questionnaire_request", group: "Planning", label: "Planning form", when: "When you send them a form" },
  { key: "questionnaire_reminder", group: "Planning", label: "Form reminder", when: "When a form is still waiting near its due date" },
  { key: "schedule_review", group: "Planning", label: "Timeline to review", when: "When their timeline is ready for them to check" },
  { key: "final_schedule_published", group: "Planning", label: "Final timeline", when: "When the timeline is published" },
  { key: "shot_list_request", group: "Planning", label: "Shot list request", when: "A month before, asking for their must-take photos" },
  { key: "final_details_request", group: "Planning", label: "Confirm final details", when: "When the details lock before the event" },
  { key: "event_reminder", group: "Planning", label: "The week before", when: "A week before the event" },

  { key: "thank_you", group: "After the event", label: "Thank you", when: "After the event" },
  { key: "delivery", group: "After the event", label: "Photos & films delivered", when: "When you deliver their gallery or film" },
  { key: "delivery_correction", group: "After the event", label: "Corrected delivery link", when: "When you replace a delivery link" },
  { key: "album_selection_reminder", group: "After the event", label: "Album picks reminder", when: "When album choices are still waiting" },
  { key: "delivery_expiry_reminder", group: "After the event", label: "Gallery expiring", when: "Before a delivery link expires" },
  { key: "review_request", group: "After the event", label: "Review request", when: "After delivery, asking for a review" },

  { key: "crew_invitation", group: "Crew", label: "Job offer", when: "When you offer someone a job" },
  { key: "crew_assigned", group: "Crew", label: "You're booked", when: "When you book someone yourself, with no offer to answer" },
  { key: "crew_directory_invitation", group: "Crew", label: "Join your crew", when: "When you add someone to your crew" },
  { key: "crew_reminder", group: "Crew", label: "Call-time reminder", when: "Two days before a job" },
  { key: "crew_monthly_roundup", group: "Crew", label: "Monthly job list", when: "On the 1st, listing their upcoming jobs" },
  { key: "crew_assignment_cancelled", group: "Crew", label: "Job canceled or released", when: "When a job is called off or you release them" },

  { key: "coi_request", group: "Insurance", label: "Certificate request", when: "When you ask your insurer for a certificate" },
  { key: "coi_correction", group: "Insurance", label: "Certificate correction", when: "When a certificate needs fixing" },
  { key: "coi_venue_delivery", group: "Insurance", label: "Certificate to the venue", when: "When you send the venue its certificate" },
];

/**
 * Emails a client or crew member can get that are not edited here, and why.
 */
export const NOT_EDITABLE: Readonly<Record<string, string>> = {
  manual_message: "Your own message: you write every word when you send it",
  client_message_received: "Sent to your studio, not to the client",
  contract_sent: "Not sent today (StudioCue agreements use Agreement to sign)",
  final_payment_reminder: "Not sent today",
};

export const EMAIL_GROUPS: readonly EmailGroup[] = [
  "Inquiry & consultation",
  "Proposal & booking",
  "Agreement",
  "Payments",
  "Planning",
  "After the event",
  "Crew",
  "Insurance",
];

/**
 * The list as one studio sees it, in its own trade's words.
 *
 * A hair stylist's editor listed "Photos & films delivered", "Album picks
 * reminder" and "Gallery expiring", and timed its call emails to "a
 * consultation" she never holds (2026-10-09). A trade that delivers nothing
 * after the day has no delivery emails to edit; the rest keep their keys and
 * say when they go in the studio's words. A photographer's list is unchanged.
 */
const DELIVERY_EMAILS = new Set(["delivery", "delivery_correction", "album_selection_reminder", "delivery_expiry_reminder"]);

export function editableEmailsFor(trade: unknown): readonly EditableEmail[] {
  const profile = tradeProfile(trade);
  if (profile.family === "photo") return EDITABLE_EMAILS;
  const words = tradeVocab(trade);
  // Makeup and hair hold no sales call; their calls are the trial and the
  // final details call, booked through the same emails.
  const call = profile.consultation ? `${words.consultation.toLowerCase()}` : "call";
  return EDITABLE_EMAILS.filter(
    (email) => (profile.delivery || !DELIVERY_EMAILS.has(email.key)) && (profile.shotList || email.key !== "shot_list_request"),
  ).map((email) => {
    switch (email.key) {
      case "consultation_invitation":
        return { ...email, when: `When you invite them to pick a ${call} time` };
      case "consultation_confirmation":
        return { ...email, when: `When a ${call} is booked` };
      case "consultation_reminder":
        return { ...email, when: `Before their ${call}` };
      case "consultation_rescheduled":
        return { ...email, when: `When a ${call} moves to a new time` };
      case "consultation_cancelled":
        return { ...email, when: `When a ${call} is canceled` };
      case "package_follow_up":
        return { ...email, when: "When you send them your package options" };
      case "proposal_sent":
        return { ...email, label: words.proposal, when: `When you send a ${words.proposal.toLowerCase()}` };
      case "review_request":
        return { ...email, when: "After the day, asking for a review" };
      default:
        return email;
    }
  });
}

/** A group's heading in the studio's words: no "consultation" where there is none. */
export function emailGroupLabel(group: EmailGroup, trade: unknown): string {
  if (group !== "Inquiry & consultation") return group;
  const profile = tradeProfile(trade);
  if (profile.family === "photo") return group;
  return profile.consultation ? `Inquiry & ${tradeVocab(trade).consultation.toLowerCase()}` : "Inquiry & calls";
}
