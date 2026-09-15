import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { ForwardedInquiry } from "../communications/forwarded-inquiry.js";

const ACTIVE_STATES = [
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
];

/**
 * A lead from a forwarded email, written the way the website form writes one.
 *
 * Same collections, same shapes, same AI job: a forwarded inquiry lands on Today
 * ranked by age, with the date checked and a reply drafted for approval — the
 * difference is only where it came from. Two things are deliberately not done:
 * the couple gets no acknowledgement email (they wrote to the studio, who is
 * already in the conversation), and a contact is created only when the message
 * shows who wrote.
 *
 * Idempotent on the provider Message-ID, so a SendGrid retry cannot create two.
 */
export async function createForwardedLead(input: {
  db: Firestore;
  tenantId: string;
  inquiry: ForwardedInquiry;
  subject: string;
  providerMessageId: string;
  now: string;
}): Promise<{ leadId: string; duplicate: boolean }> {
  const { db, tenantId, inquiry, now } = input;
  const leadId = `lead_fwd_${createHash("sha256")
    .update(`${tenantId}:${input.providerMessageId}`)
    .digest("hex")
    .slice(0, 28)}`;
  const leadReference = db.doc(`leads/${leadId}`);
  if ((await leadReference.get()).exists) return { leadId, duplicate: true };

  const email = inquiry.senderEmail;
  const [contactResult, dateConflicts, tenant] = await Promise.all([
    email
      ? db
          .collection("contacts")
          .where("tenantId", "==", tenantId)
          .where("normalizedEmail", "==", email)
          .where("archivedAt", "==", null)
          .limit(1)
          .get()
      : null,
    inquiry.eventDate
      ? db
          .collection("projects")
          .where("tenantId", "==", tenantId)
          .where("eventDate", "==", inquiry.eventDate)
          .where("state", "in", ACTIVE_STATES)
          .limit(1)
          .get()
      : null,
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  const nameParts = (inquiry.senderName ?? "").split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");
  const displayName = inquiry.senderName ?? email ?? "Forwarded inquiry";
  const existingContact = contactResult?.docs[0];
  const contactId = email ? (existingContact?.id ?? randomUUID()) : null;
  const availabilityStatus = !inquiry.eventDate
    ? "unknown"
    : dateConflicts?.empty
      ? "available"
      : "conflict";
  const missingInformation = [
    ...(inquiry.eventDate ? [] : ["event date"]),
    ...(email ? [] : ["email address"]),
    "venue",
  ];
  const systemActor = "forwarded-inquiry";
  const batch = db.batch();

  if (contactId && !existingContact) {
    batch.create(db.doc(`contacts/${contactId}`), {
      id: contactId,
      tenantId,
      firstName: firstName || displayName,
      lastName,
      displayName,
      email,
      normalizedEmail: email,
      phone: null,
      normalizedPhone: "",
      company: null,
      contactTypes: ["prospect"],
      projectIds: [],
      portalUserId: null,
      marketingConsent: false,
      notes: null,
      createdAt: now,
      updatedAt: now,
      createdBy: systemActor,
      updatedBy: systemActor,
      archivedAt: null,
    });
  }
  const tenantData = tenant.data() as { defaultLeadAssigneeId?: string; defaultEventTypeId?: string } | undefined;
  batch.create(leadReference, {
    id: leadId,
    tenantId,
    projectId: null,
    primaryContactId: contactId,
    status: "new",
    eventTypeId: tenantData?.defaultEventTypeId ?? "wedding",
    eventTypeLabel: "Wedding",
    eventDate: inquiry.eventDate,
    venue: null,
    city: null,
    estimatedGuestCount: null,
    servicesRequested: ["photography"],
    budgetRange: null,
    referralSource: inquiry.source === "email" ? "Forwarded email" : inquiry.source.replaceAll("_", " "),
    message: inquiry.message,
    assignedUserId: tenantData?.defaultLeadAssigneeId ?? null,
    duplicateKey: `${email ?? ""}||${inquiry.eventDate ?? ""}`,
    duplicateOfLeadId: null,
    displayName,
    firstName: firstName || null,
    lastName: lastName || null,
    partnerName: null,
    email,
    phone: null,
    availabilityStatus,
    aiSummary: `${displayName} wrote in${input.subject ? ` ("${input.subject}")` : ""}${
      inquiry.eventDate ? ` about ${inquiry.eventDate}` : ""
    }. ${
      availabilityStatus === "conflict"
        ? "The studio already has an active project on this date."
        : availabilityStatus === "available"
          ? "No active StudioCue project currently conflicts with this date."
          : "No event date was found in the message."
    }`,
    missingInformation,
    suggestedConsultationQuestions: [
      ...(inquiry.eventDate ? [] : ["What date are you planning for?"]),
      "Which venue or location are you considering?",
      "Which moments or outcomes matter most to you?",
    ],
    consentRecordedAt: null,
    source: `forwarded_${inquiry.source}`,
    createdAt: now,
    updatedAt: now,
    createdBy: systemActor,
    updatedBy: systemActor,
    archivedAt: null,
  });
  batch.create(db.doc(`aiJobs/lead_intake_${leadId}`), {
    id: `lead_intake_${leadId}`,
    tenantId,
    projectId: null,
    leadId,
    type: "lead_intake_analysis",
    status: "queued",
    attempts: 0,
    humanApprovalRequired: false,
    createdAt: now,
    updatedAt: now,
  });
  const auditId = randomUUID();
  batch.create(db.doc(`auditEvents/${auditId}`), {
    id: auditId,
    tenantId,
    actorId: systemActor,
    actorType: "system",
    action: "lead.created",
    entityType: "lead",
    entityId: leadId,
    timestamp: now,
    before: null,
    after: { status: "new", eventDate: inquiry.eventDate, source: `forwarded_${inquiry.source}` },
    ipAddress: null,
    userAgent: null,
    correlationId: input.providerMessageId,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return { leadId, duplicate: false };
}
