import type { Firestore } from "firebase-admin/firestore";
import { studioNotificationAddress } from "../communications/notify-address.js";

/**
 * Tell the studio a new inquiry arrived, by email.
 *
 * Today lists it, but only for a studio that opens Today, and the couple is
 * usually writing to three or four photographers at once. One email per
 * inquiry — keyed on the lead, so a retried capture never sends two — and
 * never for a "maybe", which waits for the studio to say it is one.
 *
 * An inquiry from the studio's own form carries everything the couple wrote,
 * and replies go to the couple: the studio can answer from its own inbox
 * without opening StudioCue first. One captured from the inbox does neither —
 * the original is already sitting in that inbox, and the address it read may
 * be a form builder's no-reply.
 */
export async function queueNewInquiryAlert(
  db: Firestore,
  input: {
    tenantId: string;
    leadId: string;
    projectId: string | null;
    coupleName: string;
    eventDate: string | null;
    availability: string | null;
    sourceLabel: string | null;
    now: string;
    /** What they told the studio, for a studio to answer without opening StudioCue. */
    inquiry?: {
      email: string;
      firstName: string;
      details: Array<{ label: string; value: string }>;
      message: string;
      /** They already have a job open; this joined it. */
      returning: boolean;
    };
  },
): Promise<void> {
  const recipient = await studioNotificationAddress(db, input.tenantId).catch(() => null);
  if (!recipient) return;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const eventDateLabel = input.eventDate
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${input.eventDate}T12:00:00Z`),
      )
    : "";
  const id = `new_inquiry_${input.leadId}`;
  const reference = db.doc(`emailJobs/${id}`);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists) return;
    transaction.create(reference, {
      id,
      tenantId: input.tenantId,
      projectId: null,
      leadId: null,
      type: "studio_new_inquiry",
      recipient,
      coupleName: input.coupleName,
      eventDateLabel,
      availability: input.availability ?? "unknown",
      sourceLabel: input.sourceLabel ?? "",
      ...(input.inquiry
        ? {
            // operations/jobs.ts puts these on Reply-To.
            replyAddress: input.inquiry.email,
            replyName: input.coupleName,
            replyToCouple: true,
            coupleFirstName: input.inquiry.firstName,
            details: input.inquiry.details,
            message: input.inquiry.message,
            returning: input.inquiry.returning,
          }
        : {}),
      actionUrl: input.projectId ? `${appUrl}/studio/projects/${input.projectId}` : `${appUrl}/studio/leads/${input.leadId}`,
      status: "queued",
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });
}

const COI_LABELS: Record<string, string> = { yes: "Yes", no: "No", not_sure: "Not sure" };

/**
 * The rows of a form inquiry, in the order a studio reads them: how to reach
 * them, then the day, then the studio's own questions. Only what was answered —
 * a form that hid a field leaves no empty row. Pure.
 */
export function formInquiryDetails(input: {
  email: string;
  phone: string | null;
  partnerName: string | null;
  eventTypeLabel: string | null;
  venue: string | null;
  city: string | null;
  estimatedGuestCount: number | null;
  servicesRequested: string[];
  budgetRange: string | null;
  referralSource: string | null;
  coiRequired: string | null;
  venueContactName: string | null;
  venueContactEmail: string | null;
  answers: Array<{ question: string; answer: string }>;
}): Array<{ label: string; value: string }> {
  const service = (key: string) => {
    const words = key.replaceAll("_", " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  const venueContact = [input.venueContactName, input.venueContactEmail].filter(Boolean).join(", ");
  const rows: Array<[string, string | null | undefined]> = [
    ["Email", input.email],
    ["Phone", input.phone],
    ["Partner", input.partnerName],
    ["Event", input.eventTypeLabel],
    ["Venue", input.venue],
    ["City", input.venue && input.city && input.venue.includes(input.city) ? null : input.city],
    ["Guests", input.estimatedGuestCount ? String(input.estimatedGuestCount) : null],
    // A DJ's or makeup artist's inquiry asks for that studio's own work: "Other" says nothing.
    ["Looking for", input.servicesRequested.every((key) => key === "other") ? null : input.servicesRequested.map(service).join(", ")],
    ["Budget", input.budgetRange],
    ["Heard about you", input.referralSource],
    ["Venue needs insurance", input.coiRequired ? COI_LABELS[input.coiRequired] ?? null : null],
    ["Venue contact", venueContact],
    ...input.answers.map((entry): [string, string] => [entry.question, entry.answer]),
  ];
  return rows.flatMap(([label, value]) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? [{ label, value: text }] : [];
  });
}
