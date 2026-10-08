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
  { key: "final_details_request", group: "Planning", label: "Confirm final details", when: "When the details lock before the event" },
  { key: "event_reminder", group: "Planning", label: "The week before", when: "A week before the event" },

  { key: "thank_you", group: "After the event", label: "Thank you", when: "After the event" },
  { key: "delivery", group: "After the event", label: "Photos & films delivered", when: "When you deliver their gallery or film" },
  { key: "delivery_correction", group: "After the event", label: "Corrected delivery link", when: "When you replace a delivery link" },
  { key: "album_selection_reminder", group: "After the event", label: "Album picks reminder", when: "When album choices are still waiting" },
  { key: "delivery_expiry_reminder", group: "After the event", label: "Gallery expiring", when: "Before a delivery link expires" },
  { key: "review_request", group: "After the event", label: "Review request", when: "After delivery, asking for a review" },

  { key: "crew_invitation", group: "Crew", label: "Job offer", when: "When you offer someone a job" },
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
