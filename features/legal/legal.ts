/**
 * Who operates StudioCue, which version of each legal text is live, and the
 * services that process data for it.
 *
 * One source so the Terms, the Privacy Policy, the subprocessors page, the
 * signup consent record and the email footer can never disagree. Version 1.0
 * of the Terms and 1.1 of the Privacy Policy were signed off by the owner on
 * 2026-10-03 for the 2026-10-05 launch, with counsel's review to follow
 * (docs/launch-build-plan-2026-10-05.md §1, §6). A change counsel makes ships
 * as a new version here; the signup record names the version accepted.
 *
 * functions/src/communications/email-templates.ts repeats LEGAL_ENTITY's
 * name and address for the email footer (functions/ cannot import features/);
 * tests/legal-pages.test.ts compares the two.
 */

export const LEGAL_ENTITY = {
  name: "FlawlessIQ LLC",
  product: "StudioCue",
  addressLines: ["2 Green Village Rd, Suite 209", "Madison, NJ 07940", "United States"],
  /** One line, for footers. */
  addressOneLine: "2 Green Village Rd, Suite 209, Madison, NJ 07940",
  email: "support@studio-cue.com",
  state: "New Jersey",
} as const;

export const TERMS_VERSION = "1.0";
export const TERMS_EFFECTIVE = "2026-10-05";
export const PRIVACY_VERSION = "1.1";
export const PRIVACY_EFFECTIVE = "2026-10-05";

/** "October 5, 2026". */
export function legalDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type Subprocessor = {
  name: string;
  service: string;
  purpose: string;
  data: string;
  location: string;
};

/** Always in use, for every studio. */
export const CORE_SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: "Google LLC",
    service: "Google Cloud and Firebase",
    purpose: "Hosting, database, file storage, sign-in, scheduled jobs and operational logging",
    data: "All workspace data and account details",
    location: "United States",
  },
  {
    name: "Google LLC",
    service: "Vertex AI (Gemini models)",
    purpose: "AI-assisted drafting and review inside StudioCue's own Google Cloud project",
    data: "The workspace records a feature works from, such as an inquiry, a package or a questionnaire",
    location: "United States",
  },
  {
    name: "Stripe, Inc.",
    service: "Stripe",
    purpose: "Billing for StudioCue subscriptions",
    data: "The account owner's name, email, billing details and payment card (held by Stripe, never by StudioCue)",
    location: "United States",
  },
  {
    name: "Twilio Inc.",
    service: "SendGrid",
    purpose: "Sending email and receiving forwarded email",
    data: "Recipient names and addresses, and message content",
    location: "United States",
  },
  {
    name: "Cloudflare, Inc.",
    service: "Cloudflare",
    purpose: "Domain name service and routing of email sent to StudioCue's support addresses",
    data: "Support email and DNS lookups",
    location: "Global network",
  },
];

/** Used only when a studio chooses to connect them. */
export const CONNECTED_SERVICES: readonly Subprocessor[] = [
  {
    name: "Intuit Inc.",
    service: "QuickBooks Online",
    purpose: "Creating and tracking a studio's invoices and payments",
    data: "Client names, billing addresses and invoice details",
    location: "United States",
  },
  {
    name: "Zoom Video Communications, Inc.",
    service: "Zoom",
    purpose: "Creating meetings for consultations",
    data: "Meeting time, title and invitees",
    location: "United States",
  },
  {
    name: "Google LLC",
    service: "Google Calendar",
    purpose: "Free/busy availability and the studio's own booking entries",
    data: "Busy times and the entries StudioCue creates",
    location: "United States",
  },
  {
    name: "Dropbox, Inc.",
    service: "Dropbox",
    purpose: "Storing a studio's job documents in its own Dropbox",
    data: "Documents the studio chooses to store",
    location: "United States",
  },
  {
    name: "Google LLC",
    service: "Google Maps Platform (Places)",
    purpose: "Address and venue look-up while typing",
    data: "The text typed into an address field",
    location: "United States",
  },
];
