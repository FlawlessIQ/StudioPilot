import { bulletLinePattern, clientEmailParagraphs } from "./email-content.js";

export const emailTemplateKeys = [
  "staff_invitation",
  "client_invitation",
  "crew_invitation",
  "crew_directory_invitation",
  "email_verification",
  "password_reset",
  "inquiry_acknowledgement",
  "consultation_confirmation",
  "consultation_invitation",
  "consultation_reminder",
  "package_follow_up",
  "proposal_sent",
  "contract_sent",
  "retainer_invoice",
  "booking_confirmation",
  "questionnaire_request",
  "questionnaire_reminder",
  "coi_request",
  "coi_correction",
  "coi_venue_delivery",
  "crew_reminder",
  "final_invoice",
  "final_payment_reminder",
  "schedule_review",
  "final_schedule_published",
  "event_reminder",
  "thank_you",
  "delivery",
  "review_request",
  "manual_message",
  // Studio-facing: a client wrote in and someone needs to know.
  "client_message_received",
] as const;

export type EmailTemplateKey = (typeof emailTemplateKeys)[number];

export type EmailBrand = {
  studioName: string;
  productName: string;
  accentColor: string;
  logoUrl: string | null;
  contactEmail: string | null;
};

export type RenderEmailInput = {
  key: string;
  brand: EmailBrand;
  recipientName?: string | null;
  projectName?: string | null;
  values: Record<string, unknown>;
  template?: EmailTemplateOverride | null;
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  /** The email exactly as sent, branded wrapper included. */
  text: string;
  /** Just the message, for surfaces that are not an inbox. */
  body: string;
};

type EmailCopy = {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  note?: string;
};

export type EmailTemplateOverride = {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  paragraphs: string[];
  actionLabel: string | null;
  note: string | null;
};

const stringValue = (
  values: Record<string, unknown>,
  key: string,
): string => {
  const value = values[key];
  return typeof value === "string" ? value.trim() : "";
};

const recordValue = (
  values: Record<string, unknown>,
  key: string,
): Record<string, unknown> => {
  const value = values[key];
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const numberValue = (
  values: Record<string, unknown>,
  key: string,
): number | null => {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const safeUrl = (value: string): string => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
};

const humanDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeStyle: value.includes("T") ? "short" : undefined,
      }).format(date);
};

const projectReference = (
  projectName: string | null | undefined,
): string => (projectName ? ` for ${projectName}` : "");

function templateValue(
  value: string,
  input: RenderEmailInput,
): string {
  const replacements: Record<string, string> = {
    studioName: input.brand.studioName,
    productName: input.brand.productName,
    recipientName: input.recipientName ?? "",
    projectName: input.projectName ?? "",
    portalUrl: stringValue(input.values, "portalUrl"),
    actionUrl: stringValue(input.values, "actionUrl"),
    invoiceUrl: stringValue(input.values, "invoiceUrl"),
    scheduleUrl: stringValue(input.values, "scheduleUrl"),
    galleryUrl: stringValue(input.values, "galleryUrl"),
  };
  return value.replace(
    /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g,
    (_match, key: string) => replacements[key] ?? "",
  );
}

function customizedCopy(
  base: EmailCopy,
  input: RenderEmailInput,
): EmailCopy {
  const template = input.template;
  if (!template) return base;
  return {
    subject: templateValue(template.subject, input),
    preheader: templateValue(template.preheader, input),
    eyebrow: templateValue(template.eyebrow, input),
    heading: templateValue(template.heading, input),
    paragraphs: template.paragraphs.map((paragraph) =>
      templateValue(paragraph, input),
    ),
    action:
      base.action && template.actionLabel
        ? {
            label: templateValue(template.actionLabel, input),
            url: base.action.url,
          }
        : base.action,
    note: template.note ? templateValue(template.note, input) : undefined,
  };
}

function copyFor(input: RenderEmailInput): EmailCopy {
  const { brand, values } = input;
  const recipient = input.recipientName?.trim();
  const greeting = recipient ? `Hi ${firstNameOf(recipient)},` : "Hello,";
  const project = projectReference(input.projectName);
  const inviteUrl = safeUrl(stringValue(values, "inviteUrl"));
  const actionUrl = safeUrl(stringValue(values, "actionUrl"));
  const destinationUrl = safeUrl(stringValue(values, "destinationUrl"));
  const invoiceUrl = safeUrl(stringValue(values, "invoiceUrl"));
  const portalUrl = safeUrl(stringValue(values, "portalUrl"));
  const scheduleUrl = safeUrl(stringValue(values, "scheduleUrl"));
  const galleryUrl = safeUrl(stringValue(values, "galleryUrl"));
  const requirement = recordValue(values, "requirement");

  switch (input.key as EmailTemplateKey) {
    case "staff_invitation":
      return {
        subject: `You’re invited to ${brand.studioName} on StudioCue`,
        preheader: "Accept your secure workspace invitation.",
        eyebrow: "Workspace invitation",
        heading: `Join ${brand.studioName}`,
        paragraphs: [
          greeting,
          `${brand.studioName} invited you to help manage its photography operations in StudioCue.`,
          "Use the invited email address when you create or sign in to your account.",
        ],
        action: inviteUrl
          ? { label: "Accept workspace invitation", url: inviteUrl }
          : undefined,
        note: "This secure invitation expires after seven days.",
      };
    case "client_invitation":
      return {
        subject: `${brand.studioName} invited you to your client portal`,
        preheader: "Your secure photography project portal is ready.",
        eyebrow: "Client portal",
        heading: `Your project space is ready`,
        paragraphs: [
          greeting,
          `${brand.studioName} created a private portal${project} where you can see next steps, complete questionnaires, review the schedule, and access approved documents.`,
          "Activate access using the same email address that received this invitation.",
        ],
        action: inviteUrl
          ? { label: "Activate client portal", url: inviteUrl }
          : undefined,
        note:
          "For your security, this link expires after seven days and can be revoked by the studio.",
      };
    case "crew_invitation":
      {
        const role = stringValue(values, "role");
        const arrivalAt = stringValue(values, "arrivalAt");
        const departureAt = stringValue(values, "departureAt");
        const respondBy = stringValue(values, "respondBy");
        const locationName = stringValue(values, "locationName");
        const locationAddress = stringValue(values, "locationAddress");
        const compensationCents = numberValue(values, "compensationCents");
        const currency = stringValue(values, "currency") || "USD";
        const compensation =
          values.compensationVisibleToCrew === true && compensationCents !== null
            ? `${new Intl.NumberFormat("en-US", {
                style: "currency",
                currency,
              }).format(compensationCents / 100)}${
                stringValue(values, "compensationType") === "hourly"
                  ? " per hour"
                  : " total"
              }`
            : "Available in the secure assignment brief";
        const details = [
          role ? `Role: ${role}` : "",
          arrivalAt && departureAt
            ? `Time: ${humanDate(arrivalAt)} through ${humanDate(departureAt)}`
            : "",
          locationName
            ? `Location: ${locationName}${locationAddress ? ` — ${locationAddress}` : ""}`
            : "",
          `Compensation: ${compensation}`,
          respondBy ? `Please respond by ${humanDate(respondBy)}.` : "",
        ].filter(Boolean);
      return {
        subject: `${role ? `${role} — ` : ""}Photography assignment from ${brand.studioName}`,
        preheader: respondBy
          ? `Review the job details and respond by ${humanDate(respondBy)}.`
          : "Review and respond to your assignment.",
        eyebrow: "Crew assignment",
        heading: `A new assignment is ready`,
        paragraphs: [
          greeting,
          `${brand.studioName} invited you to review a photography assignment${project}.`,
          ...details,
          "Open the secure job brief to review responsibilities and requirements before accepting or declining.",
        ],
        action: inviteUrl
          ? { label: "Review assignment", url: inviteUrl }
          : undefined,
        note: "The secure brief is the source of truth if the studio updates this offer.",
      };
      }
    case "crew_directory_invitation":
      /**
       * Joining the roster, which is not the same as being offered a job.
       *
       * `crew_invitation` is an offer: it names a role, a date, a location and
       * a fee, and asks for a yes or a no. This one has no job attached — the
       * studio has added someone to their directory and wants them set up
       * before any work exists, so the ask is to create an account and fill in
       * the paperwork that would otherwise sit "missing" forever.
       */
      return {
        subject: `${brand.studioName} added you to their crew roster`,
        preheader: "Set up your profile so you're ready for the next job.",
        eyebrow: "Crew roster",
        heading: "You've been added to the crew",
        paragraphs: [
          greeting,
          `${brand.studioName} added you to their crew roster on StudioCue. There's no job attached to this yet — it means they'd like you ready for one.`,
          "Setting up your profile takes a few minutes: confirm your specialties and the areas you travel to, mark the dates you're free, and send over your W-9 and proof of insurance.",
          "Once that's done you'll see any assignment they offer you, with the schedule and the brief, in the same place.",
        ],
        action: inviteUrl
          ? { label: "Set up your crew profile", url: inviteUrl }
          : undefined,
        note:
          "For your security, this link expires after seven days and can be revoked by the studio.",
      };
    case "email_verification":
      return {
        subject: "Verify your StudioCue email",
        preheader: "Confirm your email to secure your account.",
        eyebrow: "Account security",
        heading: "Verify your email address",
        paragraphs: [
          greeting,
          "Confirm that this email belongs to you before accessing a StudioCue workspace or portal.",
        ],
        action: actionUrl
          ? { label: "Verify email address", url: actionUrl }
          : undefined,
        note:
          "If you did not create a StudioCue account, you can safely ignore this email.",
      };
    case "password_reset":
      return {
        subject: "Reset your StudioCue password",
        preheader: "Use this secure link to choose a new password.",
        eyebrow: "Account security",
        heading: "Choose a new password",
        paragraphs: [
          greeting,
          "We received a request to reset the password for your StudioCue account.",
        ],
        action: actionUrl
          ? { label: "Reset password", url: actionUrl }
          : undefined,
        note:
          "If you did not request this change, ignore this email. Your password will remain unchanged.",
      };
    case "inquiry_acknowledgement":
      return {
        subject: `${brand.studioName} received your inquiry`,
        preheader: "Your photography inquiry is safely with the studio.",
        eyebrow: "Inquiry received",
        heading: "Thank you for reaching out",
        paragraphs: [
          greeting,
          `${brand.studioName} received your inquiry and will review the event details before confirming availability or recommending a next step.`,
        ],
        action: portalUrl
          ? { label: "View your inquiry", url: portalUrl }
          : undefined,
      };
    case "consultation_confirmation":
    case "consultation_reminder": {
      const startsAt = humanDate(stringValue(values, "startsAt"));
      const isReminder = input.key === "consultation_reminder";
      return {
        subject: `${isReminder ? "Reminder: " : ""}Consultation with ${brand.studioName}`,
        preheader: `${isReminder ? "Your consultation is coming up." : "Your consultation is confirmed."}`,
        eyebrow: isReminder ? "Consultation reminder" : "Consultation confirmed",
        heading: isReminder ? "We’ll see you soon" : "Your consultation is booked",
        paragraphs: [
          greeting,
          `${brand.studioName} ${isReminder ? "is looking forward to" : "confirmed"} your consultation${startsAt ? ` on ${startsAt}` : ""}.`,
          stringValue(values, "location")
            ? `Location or meeting details: ${stringValue(values, "location")}`
            : "Your studio will share any final meeting details before the appointment.",
        ],
        action: actionUrl
          ? { label: "View consultation", url: actionUrl }
          : undefined,
      };
    }
    case "consultation_invitation":
      return {
        subject: `Choose a consultation time with ${brand.studioName}`,
        preheader: "Select a convenient time for your photography consultation.",
        eyebrow: "Consultation invitation",
        heading: "Let’s find a time to talk",
        paragraphs: [
          greeting,
          `${brand.studioName} invited you to choose a consultation time${project}.`,
          "Open the secure scheduler to see the studio’s current availability. A confirmation will be sent after you choose a time.",
        ],
        action: actionUrl
          ? { label: "Choose a consultation time", url: actionUrl }
          : undefined,
        note: "Times remain available until another client confirms them.",
      };
    case "package_follow_up":
      return {
        subject: `Photography options from ${brand.studioName}`,
        preheader: "Review the coverage options prepared for your event.",
        eyebrow: "Your photography options",
        heading: "Let’s find the right coverage",
        paragraphs: [
          greeting,
          `${brand.studioName} prepared the next step${project}. Review the available coverage and send any questions before making a selection.`,
        ],
        action: portalUrl
          ? { label: "Review packages", url: portalUrl }
          : undefined,
      };
    case "proposal_sent":
      return {
        subject: `Your proposal from ${brand.studioName}`,
        preheader: "Review your photography proposal and pricing.",
        eyebrow: "Proposal ready",
        heading: "Your proposal is ready to review",
        paragraphs: [
          greeting,
          `${brand.studioName} prepared a proposal${project} with your selected coverage, pricing, payment schedule, and terms summary.`,
          "Review the live proposal in your secure client portal. A PDF copy is attached for your records.",
        ],
        action: actionUrl
          ? { label: "Review proposal", url: actionUrl }
          : undefined,
        note:
          "Accepting a proposal does not sign a contract or collect a payment. Those steps remain separate.",
      };
    case "contract_sent":
      return {
        subject: `Agreement ready from ${brand.studioName}`,
        preheader: "Review and sign your photography agreement.",
        eyebrow: "Agreement ready",
        heading: "Your agreement is ready to sign",
        paragraphs: [
          greeting,
          `${brand.studioName} sent the photography agreement${project} through its secure signature provider.`,
        ],
        action: actionUrl
          ? { label: "Review agreement", url: actionUrl }
          : undefined,
        note:
          "StudioCue will not mark an agreement complete until the signature provider confirms completion.",
      };
    case "retainer_invoice":
    case "final_invoice":
    case "final_payment_reminder": {
      const isRetainer = input.key === "retainer_invoice";
      const isReminder = input.key === "final_payment_reminder";
      const label = isRetainer ? "retainer" : "final balance";
      return {
        subject: `${isReminder ? "Reminder: " : ""}${isRetainer ? "Retainer" : "Final invoice"} from ${brand.studioName}`,
        preheader: `Review your ${label} in the secure accounting portal.`,
        eyebrow: isReminder ? "Payment reminder" : "Invoice ready",
        heading: isReminder
          ? `Your ${label} is still due`
          : `Your ${label} invoice is ready`,
        paragraphs: [
          greeting,
          `${brand.studioName} ${isReminder ? "is reminding you about" : "created"} the ${label} invoice${project}.`,
          "Payment status and payment collection remain in the studio’s secure accounting system.",
        ],
        action: invoiceUrl
          ? { label: "Open secure invoice", url: invoiceUrl }
          : undefined,
      };
    }
    case "booking_confirmation":
      return {
        subject: `You’re booked with ${brand.studioName}`,
        preheader: "Your photography project is officially booked.",
        eyebrow: "Booking confirmed",
        heading: "Your date is officially booked",
        paragraphs: [
          greeting,
          `${brand.studioName} confirmed the required agreement and retainer steps${project}.`,
          "Your portal will keep the next actions, planning details, documents, and schedule in one place.",
        ],
        action: portalUrl
          ? { label: "Open client portal", url: portalUrl }
          : undefined,
      };
    case "questionnaire_request":
    case "questionnaire_reminder": {
      const reminder = input.key === "questionnaire_reminder";
      return {
        subject: `${reminder ? "Reminder: " : ""}Details needed by ${brand.studioName}`,
        preheader: "Complete your photography project questionnaire.",
        eyebrow: reminder ? "Questionnaire reminder" : "Planning questionnaire",
        heading: reminder
          ? "A few project details are still needed"
          : "Help us plan the details",
        paragraphs: [
          greeting,
          `${brand.studioName} ${reminder ? "is still waiting for" : "is ready to collect"} the planning information${project}. You can save your progress and return before submitting.`,
        ],
        action: actionUrl
          ? { label: "Complete questionnaire", url: actionUrl }
          : undefined,
      };
    }
    case "coi_request":
      return {
        subject: `Certificate of insurance request from ${brand.studioName}`,
        preheader: "A certificate is needed for an upcoming photography event.",
        eyebrow: "Insurance document request",
        heading: "Please prepare a certificate of insurance",
        paragraphs: [
          greeting,
          `${brand.studioName} needs a certificate for ${String(requirement.venueLegalName ?? "the venue")} on ${String(requirement.eventDate ?? "the event date")}.`,
          `Certificate holder: ${String(requirement.certificateHolder ?? "See the attached requirements")}. Due: ${String(requirement.dueDate ?? "As soon as possible")}.`,
          "Reply to this email with one PDF attachment. The studio will review the certificate before it is sent to the venue.",
        ],
      };
    case "coi_correction":
      return {
        subject: `Certificate correction requested by ${brand.studioName}`,
        preheader: "The studio needs a corrected insurance certificate.",
        eyebrow: "Correction requested",
        heading: "Please revise the certificate",
        paragraphs: [
          greeting,
          `${brand.studioName} reviewed the submitted certificate and needs a correction.`,
          `Studio review note: ${stringValue(values, "reason") || "Please contact the studio for the requested correction."}`,
          "Reply to this email with one corrected PDF attachment.",
        ],
      };
    case "coi_venue_delivery":
      return {
        subject: `Approved certificate from ${brand.studioName}`,
        preheader: "The studio-approved certificate is attached.",
        eyebrow: "Certificate delivery",
        heading: "Approved certificate attached",
        paragraphs: [
          greeting,
          `${brand.studioName} reviewed and approved the attached certificate for ${stringValue(values, "venueName") || "the upcoming event venue"}.`,
        ],
      };
    case "crew_reminder":
      return {
        subject: `Action needed for your ${brand.studioName} assignment`,
        preheader: "Review the remaining assignment requirement.",
        eyebrow: "Crew reminder",
        heading: "Your assignment needs attention",
        paragraphs: [
          greeting,
          `${brand.studioName} is waiting for an assignment response, document, or schedule acknowledgement${project}.`,
        ],
        action: actionUrl
          ? { label: "Open job brief", url: actionUrl }
          : undefined,
      };
    case "schedule_review":
    case "final_schedule_published": {
      const final = input.key === "final_schedule_published";
      return {
        subject: `${final ? "Final schedule published" : "Schedule ready for review"} — ${brand.studioName}`,
        preheader: final
          ? "Open the current event-day schedule."
          : "Review the proposed event schedule.",
        eyebrow: final ? "Final schedule" : "Schedule review",
        heading: final
          ? "The final schedule is published"
          : "The schedule is ready for review",
        paragraphs: [
          greeting,
          `${brand.studioName} ${final ? "published the current event-day schedule" : "prepared a schedule for your review"}${project}.`,
          final
            ? "Please use this version on the event day. Relevant crew may be asked to acknowledge changes."
            : "Send any requested changes before approval.",
        ],
        action: scheduleUrl
          ? { label: final ? "Open final schedule" : "Review schedule", url: scheduleUrl }
          : undefined,
      };
    }
    case "event_reminder":
      return {
        subject: `Your event with ${brand.studioName} is coming up`,
        preheader: "Review the final event details and schedule.",
        eyebrow: "Event reminder",
        heading: "We’re ready for your event",
        paragraphs: [
          greeting,
          `${brand.studioName} is looking forward to your event${project}. Review the current schedule, arrival details, and any remaining next action in your portal.`,
          "To help photography begin on time, please have the wedding dress on a hanger and keep the shoes, flowers, rings, and invitation suite together before the team arrives.",
        ],
        action: portalUrl
          ? { label: "Open project portal", url: portalUrl }
          : undefined,
      };
    case "thank_you":
      return {
        subject: `Thank you from ${brand.studioName}`,
        preheader: "Thank you for trusting the studio with your event.",
        eyebrow: "Thank you",
        heading: "It was a privilege to be there",
        paragraphs: [
          greeting,
          `${brand.studioName} appreciates the trust you placed in the team${project}. The studio will keep your portal updated as post-production progresses.`,
        ],
      };
    case "delivery": {
      const accessCode = stringValue(values, "accessCode");
      const expirationDate = stringValue(values, "expirationDate");
      return {
        subject: `Your photographs are ready from ${brand.studioName}`,
        preheader: "Open your secure delivery.",
        eyebrow: "Delivery ready",
        heading: "Your photographs are ready",
        paragraphs: [
          greeting,
          `${brand.studioName} completed your delivery${project}. Use the secure link below and keep any access code private.`,
          ...(accessCode ? [`Gallery access code: ${accessCode}`] : []),
          ...(expirationDate
            ? [`Please download and back up your photographs before ${humanDate(expirationDate)}.`]
            : []),
        ],
        action: galleryUrl
          ? { label: "Open delivery", url: galleryUrl }
          : undefined,
      };
    }
    case "review_request":
      return {
        subject: `Would you share your experience with ${brand.studioName}?`,
        preheader: "A short review helps future clients choose their photographer.",
        eyebrow: "Client feedback",
        heading: "Thank you for choosing us",
        paragraphs: [
          greeting,
          `${brand.studioName} would be grateful if you shared an honest review of your experience.`,
          "Opening the review link does not tell the studio that a review was posted. You can confirm completion separately in your portal.",
        ],
        action: destinationUrl
          ? { label: "Share your experience", url: destinationUrl }
          : undefined,
      };
    case "manual_message": {
      const subject =
        stringValue(values, "customSubject") ||
        `${brand.studioName} sent you an update`;
      const body =
        stringValue(values, "customBody") ||
        `${brand.studioName} has an update for you.`;
      const label = stringValue(values, "actionLabel") || "Open project portal";
      return {
        subject,
        preheader: body.slice(0, 120),
        eyebrow: "A note from your studio",
        heading: input.projectName
          ? `A note about ${input.projectName}`
          : `An update from ${brand.studioName}`,
        paragraphs: [greeting, ...clientEmailParagraphs(body)],
        action: actionUrl ? { label, url: actionUrl } : undefined,
      };
    }
    // Studio-facing, unlike almost everything else here. A client writing in
    // used to produce an in-app task and nothing else, so the studio only found
    // out by logging in and looking.
    case "client_message_received": {
      const senderName = stringValue(values, "senderName") || "A client";
      const messageSubject = stringValue(values, "messageSubject");
      const messagePreview = stringValue(values, "messagePreview");
      const preparedReply = stringValue(values, "preparedReplyBody");
      const approveUrl = safeUrl(stringValue(values, "approveUrl"));
      const basedOn = Array.isArray(values.preparedReplyBasedOn)
        ? (values.preparedReplyBasedOn as unknown[]).map(String).filter(Boolean)
        : [];

      // When StudioCue already holds the answer, the answer belongs in this
      // email. Making the studio open the app to read a reply the system had
      // composed from its own records is the step worth removing.
      if (preparedReply && approveUrl) {
        return {
          subject: `${senderName} asked: ${messageSubject || "a question"}`,
          preheader: "A reply is ready — read it and send in one tap.",
          eyebrow: "Client message",
          heading: `${senderName} asked a question`,
          paragraphs: [
            greeting,
            ...(messagePreview ? [`They wrote: “${messagePreview}”`] : []),
            "StudioCue has a reply ready from your project records:",
            preparedReply,
            ...(basedOn.length ? [`Based on: ${basedOn.join("; ")}`] : []),
          ],
          action: { label: "Review and send this reply", url: approveUrl },
          note: "Nothing is sent until you confirm on that page.",
        };
      }

      return {
        subject: `${senderName} sent you a message${project}`,
        preheader:
          messageSubject || "A new client message is waiting in StudioCue.",
        eyebrow: "Client message",
        heading: `${senderName} sent you a message`,
        paragraphs: [
          greeting,
          `${senderName} wrote to you${project}.`,
          ...(messageSubject ? [`Subject: ${messageSubject}`] : []),
          ...(messagePreview ? [`“${messagePreview}”`] : []),
        ],
        action: actionUrl
          ? { label: "Open the message", url: actionUrl }
          : undefined,
        note: "Reply in StudioCue so the exchange stays on the project record.",
      };
    }
    default:
      return {
        subject: `${brand.studioName} sent you an update`,
        preheader: "A photography project update is available.",
        eyebrow: "Project update",
        heading: "There’s an update from your studio",
        paragraphs: [
          greeting,
          `${brand.studioName} has an update for you in StudioCue.`,
        ],
        action: actionUrl
          ? { label: "View update", url: actionUrl }
          : undefined,
      };
  }
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const normalizeColor = (value: string): string =>
  /^#[0-9a-f]{6}$/i.test(value) ? value : "#35664a";

/**
 * How a person is addressed: "Hi John," not "Hi John Smith,".
 *
 * The contact record holds a full name because that is what a contact record
 * is for, and the greeting used it verbatim — every client email opened by
 * addressing the couple the way a form letter does.
 *
 * An honorific on its own is worse than the full name ("Hi Dr.,"), so skip it
 * and take the name after it.
 */
const honorific = /^(?:mr|mrs|ms|miss|mx|dr|prof|rev|sir|dame)\.?$/i;

export function firstNameOf(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const [first, second] = parts;
  if (!first) return value.trim();
  if (second && honorific.test(first)) return second;
  return first;
}

const listItemsHtml = (lines: string[]): string =>
  lines
    .map(
      (line) =>
        `<li style="margin:0 0 8px;">${escapeHtml(line.replace(bulletLinePattern, ""))}</li>`,
    )
    .join("");

/**
 * A paragraph, or a list when that is what was written.
 *
 * Everything here used to become a `<p>`, so a block of bullet lines rendered
 * as one wall of text with stray hyphens in it.
 */
const paragraphHtml = (paragraph: string): string => {
  const lines = paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1 && lines.every((line) => bulletLinePattern.test(line))) {
    const ordered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
    const tag = ordered ? "ol" : "ul";
    return `<${tag} class="email-list" style="margin:0 0 18px;padding-left:22px;color:#4f5752;font-size:16px;line-height:1.7;">${listItemsHtml(lines)}</${tag}>`;
  }
  return `<p class="email-paragraph" style="margin:0 0 18px;color:#4f5752;font-size:16px;line-height:1.7;">${escapeHtml(paragraph)}</p>`;
};

export function renderEmailTemplate(input: RenderEmailInput): RenderedEmail {
  const copy = customizedCopy(copyFor(input), input);
  const accent = normalizeColor(input.brand.accentColor);
  const studioName = escapeHtml(input.brand.studioName);
  const productName = escapeHtml(input.brand.productName);
  const logoUrl = input.brand.logoUrl
    ? safeUrl(input.brand.logoUrl)
    : "";
  const action = copy.action?.url
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 26px;"><tr><td style="border-radius:10px;background:${accent};"><a href="${escapeHtml(copy.action.url)}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1.2;">${escapeHtml(copy.action.label)}</a></td></tr></table>`
    : "";
  const note = copy.note
    ? `<div style="margin-top:28px;padding:16px 18px;border:1px solid #dde3de;border-radius:12px;background:#f5f7f5;color:#626a65;font-size:13px;line-height:1.6;">${escapeHtml(copy.note)}</div>`
    : "";
  const brandMark = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="44" height="44" alt="${studioName}" style="display:block;width:44px;height:44px;border-radius:10px;object-fit:contain;">`
    : `<div style="width:44px;height:44px;border-radius:10px;background:#151916;color:#ffffff;font-size:19px;font-weight:800;line-height:44px;text-align:center;">${escapeHtml(input.brand.studioName.charAt(0).toUpperCase())}</div>`;
  const contact = input.brand.contactEmail
    ? ` Questions? Reply to this email or contact <a href="mailto:${escapeHtml(input.brand.contactEmail)}" style="color:#4f5752;">${escapeHtml(input.brand.contactEmail)}</a>.`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(copy.subject)}</title>
  <style>
    @media screen and (max-width:600px) {
      .email-shell { padding:20px 10px !important; }
      .email-brand { padding-bottom:16px !important; }
      .email-content { padding:28px 22px 24px !important; }
      .email-heading { font-size:25px !important; line-height:1.22 !important; margin-bottom:20px !important; }
      .email-paragraph { font-size:16px !important; line-height:1.58 !important; }
      .email-footer { padding-left:8px !important; padding-right:8px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef1ee;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171a18;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#eef1ee;">
    <tr><td class="email-shell" align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;">
        <tr><td class="email-brand" style="padding:0 4px 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td style="vertical-align:middle;">${brandMark}</td>
            <td style="padding-left:12px;vertical-align:middle;">
              <strong style="display:block;color:#171a18;font-size:17px;line-height:1.3;">${studioName}</strong>
              <span style="display:block;color:#778079;font-size:12px;line-height:1.4;">Client operations powered by ${productName}</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="overflow:hidden;border:1px solid #dde2de;border-radius:18px;background:#ffffff;box-shadow:0 14px 38px rgba(23,26,24,0.08);">
          <div style="height:6px;background:${accent};"></div>
          <div class="email-content" style="padding:42px 44px 38px;">
            <p style="margin:0 0 13px;color:${accent};font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(copy.eyebrow)}</p>
            <h1 class="email-heading" style="margin:0 0 24px;color:#171a18;font-size:31px;line-height:1.18;letter-spacing:-0.025em;">${escapeHtml(copy.heading)}</h1>
            ${copy.paragraphs.map(paragraphHtml).join("")}
            ${action}
            ${note}
          </div>
        </td></tr>
        <tr><td class="email-footer" style="padding:20px 18px 0;color:#7b837d;font-size:12px;line-height:1.65;text-align:center;">
          Sent by ${studioName} using ${productName}.${contact}<br>
          This message relates to a private studio workspace or photography project.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `${input.brand.studioName} · Powered by ${input.brand.productName}`,
    "",
    copy.heading,
    "",
    ...copy.paragraphs,
    ...(copy.action ? ["", `${copy.action.label}: ${copy.action.url}`] : []),
    ...(copy.note ? ["", copy.note] : []),
    "",
    `Sent by ${input.brand.studioName} using ${input.brand.productName}.`,
  ].join("\n");

  // What the studio actually said, without the branded wrapper. `text` is the
  // email as sent and stays the record of that; this is the same content for
  // places that are not an inbox — a thread bubble reading "FlawlessIQ · Powered
  // by StudioCue" above every message, and "Sent by FlawlessIQ using StudioCue"
  // below it, is repeating the letterhead inside the letter.
  const body = [
    copy.heading,
    "",
    ...copy.paragraphs,
    ...(copy.action ? ["", `${copy.action.label}: ${copy.action.url}`] : []),
    ...(copy.note ? ["", copy.note] : []),
  ]
    .join("\n")
    .trim();

  return {
    subject: copy.subject,
    preheader: copy.preheader,
    html,
    text,
    body,
  };
}
