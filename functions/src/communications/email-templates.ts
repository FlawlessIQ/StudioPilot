export const emailTemplateKeys = [
  "staff_invitation",
  "client_invitation",
  "crew_invitation",
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
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
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

function copyFor(input: RenderEmailInput): EmailCopy {
  const { brand, values } = input;
  const recipient = input.recipientName?.trim();
  const greeting = recipient ? `Hi ${recipient},` : "Hello,";
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
      return {
        subject: `Photography assignment from ${brand.studioName}`,
        preheader: "Review and respond to your assignment.",
        eyebrow: "Crew assignment",
        heading: `A new assignment is ready`,
        paragraphs: [
          greeting,
          `${brand.studioName} invited you to review a photography assignment${project}.`,
          "Open the secure job brief to review timing, locations, responsibilities, and required acknowledgements.",
        ],
        action: inviteUrl
          ? { label: "Review assignment", url: inviteUrl }
          : undefined,
        note: "Compensation is shown only when the studio has chosen to share it.",
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
    case "delivery":
      return {
        subject: `Your photographs are ready from ${brand.studioName}`,
        preheader: "Open your secure delivery.",
        eyebrow: "Delivery ready",
        heading: "Your photographs are ready",
        paragraphs: [
          greeting,
          `${brand.studioName} completed your delivery${project}. Use the secure link below and keep any access code private.`,
        ],
        action: galleryUrl
          ? { label: "Open delivery", url: galleryUrl }
          : undefined,
      };
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
        heading: subject,
        paragraphs: [greeting, body],
        action: actionUrl ? { label, url: actionUrl } : undefined,
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

const paragraphHtml = (paragraph: string): string =>
  `<p style="margin:0 0 18px;color:#4f5752;font-size:16px;line-height:1.7;">${escapeHtml(paragraph)}</p>`;

export function renderEmailTemplate(input: RenderEmailInput): RenderedEmail {
  const copy = copyFor(input);
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
</head>
<body style="margin:0;padding:0;background:#eef1ee;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171a18;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#eef1ee;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;">
        <tr><td style="padding:0 4px 20px;">
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
          <div style="padding:42px 44px 38px;">
            <p style="margin:0 0 13px;color:${accent};font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(copy.eyebrow)}</p>
            <h1 style="margin:0 0 24px;color:#171a18;font-size:31px;line-height:1.18;letter-spacing:-0.025em;">${escapeHtml(copy.heading)}</h1>
            ${copy.paragraphs.map(paragraphHtml).join("")}
            ${action}
            ${note}
          </div>
        </td></tr>
        <tr><td style="padding:20px 18px 0;color:#7b837d;font-size:12px;line-height:1.65;text-align:center;">
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

  return {
    subject: copy.subject,
    preheader: copy.preheader,
    html,
    text,
  };
}
