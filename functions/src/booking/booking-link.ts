import { createHash, randomBytes } from "node:crypto";
import { FINAL_DETAILS_PURPOSE, TRIAL_PURPOSE, type ConsultationPurpose } from "./consultation-purpose.js";

/**
 * A link a client uses to book a call: the sales consultation the studio
 * invites them to, or the final details call the details lock sends
 * (planning/final-details.ts). One place mints both, so they are the same
 * kind of link and book through the same page.
 *
 * The id is one per job, client and purpose. It was one per job and client,
 * so a final-call link would have overwritten the couple's consultation link.
 */
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export type BookingLinkMode = "zoom" | "in_person" | "phone" | "custom";

export function mintBookingLink(input: {
  tenantId: string;
  projectId: string;
  contactId: string;
  email: string;
  mode: BookingLinkMode;
  purpose: ConsultationPurpose;
  actorId: string;
  now: string;
  /** How long it stays open. */
  days: number;
}) {
  const token = randomBytes(32).toString("base64url");
  const key = hash(`${input.tenantId}:${input.projectId}:${input.email}`).slice(0, 32);
  const linkId =
    input.purpose === FINAL_DETAILS_PURPOSE ? `final_${key}` : input.purpose === TRIAL_PURPOSE ? `trial_${key}` : `consult_${key}`;
  const expiresAt = new Date(Date.parse(input.now) + input.days * 86400000).toISOString();
  const bookingUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/schedule/consultation?token=${encodeURIComponent(token)}`;
  return {
    linkId,
    bookingUrl,
    expiresAt,
    record: {
      id: linkId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      contactId: input.contactId,
      mode: input.mode,
      purpose: input.purpose,
      tokenHash: hash(token),
      status: "pending",
      expiresAt,
      bookedConsultationId: null,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    },
  };
}
