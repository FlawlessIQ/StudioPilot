import type { Firestore } from "firebase-admin/firestore";
import { studioNotificationAddress } from "../communications/notify-address.js";

/**
 * Tell the studio a new inquiry arrived, by email.
 *
 * Today lists it, but only for a studio that opens Today, and the couple is
 * usually writing to three or four photographers at once. One email per
 * inquiry — keyed on the lead, so a retried capture never sends two — and
 * never for a "maybe", which waits for the studio to say it is one.
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
      actionUrl: input.projectId ? `${appUrl}/studio/projects/${input.projectId}` : `${appUrl}/studio/leads/${input.leadId}`,
      status: "queued",
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });
}
