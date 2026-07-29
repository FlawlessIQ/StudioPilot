import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requestFingerprint, requireAppCheck } from "./security.js";
import { studioHubCors } from "../security/cors.js";

const serviceSchema = z.enum([
  "photography",
  "videography",
  "engagement_session",
  "second_shooter",
  "album",
  "prints",
  "corporate_licensing",
  "team_photos",
  "other",
]);

const intakeSchema = z.object({
  tenantSlug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  partnerName: z.string().trim().max(120).nullable().default(null),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7).max(30),
  eventDate: z.string().date(),
  eventType: z.string().trim().min(2).max(80),
  venue: z.string().trim().max(160).nullable().default(null),
  city: z.string().trim().min(2).max(120),
  estimatedGuestCount: z
    .number()
    .int()
    .min(1)
    .max(100000)
    .nullable()
    .default(null),
  servicesRequested: z.array(serviceSchema).min(1),
  budgetRange: z.string().trim().max(80).nullable().default(null),
  referralSource: z.string().trim().max(120).nullable().default(null),
  message: z.string().trim().min(10).max(5000),
  consent: z.literal(true),
  source: z.string().trim().max(120).default("public_inquiry"),
  honeypot: z.string().max(0).default(""),
});

const missingFields = (input: z.infer<typeof intakeSchema>): string[] => {
  const fields: string[] = [];
  if (!input.venue) fields.push("venue");
  if (!input.budgetRange) fields.push("budget range");
  if (!input.referralSource) fields.push("referral source");
  if (!input.estimatedGuestCount) fields.push("estimated guest count");
  return fields;
};

export const publicLeadIntake = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }

    try {
      await requireAppCheck(request);
    } catch {
      response.status(401).json({ error: "APP_CHECK_REQUIRED" });
      return;
    }

    const parsed = intakeSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "INVALID_INQUIRY",
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      return;
    }

    const input = parsed.data;
    const db = getFirestore();
    const tenantResult = await db
      .collection("tenants")
      .where("publicSlug", "==", input.tenantSlug)
      .where("status", "in", ["trial", "active"])
      .limit(1)
      .get();
    const tenantDocument = tenantResult.docs[0];
    if (!tenantDocument) {
      response.status(404).json({ error: "INQUIRY_FORM_UNAVAILABLE" });
      return;
    }

    const tenantId = tenantDocument.id;
    const rateLimitId = requestFingerprint(request, `lead:${tenantId}`);
    const rateLimitReference = db.doc(`publicRateLimits/${rateLimitId}`);
    const nowMillis = Date.now();
    const oneHourMillis = 60 * 60 * 1000;

    try {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(rateLimitReference);
        const data = snapshot.data() as
          | { windowStartedAt: number; count: number }
          | undefined;
        const withinWindow =
          data && nowMillis - data.windowStartedAt < oneHourMillis;
        const nextCount = withinWindow ? data.count + 1 : 1;
        if (nextCount > 5) throw new Error("RATE_LIMITED");
        transaction.set(rateLimitReference, {
          windowStartedAt: withinWindow ? data.windowStartedAt : nowMillis,
          count: nextCount,
          expiresAt: new Date(nowMillis + oneHourMillis * 2).toISOString(),
        });
      });
    } catch {
      response.status(429).json({ error: "RATE_LIMITED" });
      return;
    }

    const normalizedEmail = input.email.toLowerCase();
    const normalizedPhone = input.phone.replace(/\D/g, "");
    const duplicateKey = `${normalizedEmail}|${normalizedPhone}|${input.eventDate}`;
    const [contactResult, duplicateResult, dateConflicts] = await Promise.all([
      db
        .collection("contacts")
        .where("tenantId", "==", tenantId)
        .where("normalizedEmail", "==", normalizedEmail)
        .where("archivedAt", "==", null)
        .limit(1)
        .get(),
      db
        .collection("leads")
        .where("tenantId", "==", tenantId)
        .where("duplicateKey", "==", duplicateKey)
        .where("archivedAt", "==", null)
        .limit(1)
        .get(),
      db
        .collection("projects")
        .where("tenantId", "==", tenantId)
        .where("eventDate", "==", input.eventDate)
        .where("state", "in", [
          "CONSULTATION",
          "PROPOSAL",
          "CONTRACT_PENDING",
          "RETAINER_PENDING",
          "BOOKED",
          "PLANNING",
          "READY",
        ])
        .limit(1)
        .get(),
    ]);
    const existingContact = contactResult.docs[0];
    const duplicateLead = duplicateResult.docs[0];
    const contactId = existingContact?.id ?? randomUUID();
    const leadId = randomUUID();
    const auditId = randomUUID();
    const timestamp = new Date(nowMillis).toISOString();
    const systemActor = "public-lead-intake";
    const batch = db.batch();

    if (!existingContact) {
      batch.create(db.doc(`contacts/${contactId}`), {
        id: contactId,
        tenantId,
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: `${input.firstName} ${input.lastName}`,
        email: input.email,
        normalizedEmail,
        phone: input.phone,
        normalizedPhone,
        company: null,
        contactTypes: ["prospect"],
        projectIds: [],
        portalUserId: null,
        marketingConsent: true,
        notes: input.partnerName ? `Partner: ${input.partnerName}` : null,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: systemActor,
        updatedBy: systemActor,
        archivedAt: null,
      });
    }

    const tenantData = tenantDocument.data() as {
      defaultLeadAssigneeId?: string;
      defaultEventTypeId?: string;
    };
    const missingInformation = missingFields(input);
    const availabilityStatus = dateConflicts.empty ? "available" : "conflict";
    const displayName = `${input.firstName} ${input.lastName}`.trim();
    const suggestedConsultationQuestions = [
      ...(missingInformation.includes("venue")
        ? ["Which venue or location are you considering?"]
        : []),
      ...(missingInformation.includes("estimated guest count")
        ? ["What guest count are you currently planning for?"]
        : []),
      ...(missingInformation.includes("budget range")
        ? ["What investment range should the studio keep in mind?"]
        : []),
      "Which moments or outcomes matter most to you?",
      "Who else should participate in planning and approvals?",
    ].slice(0, 6);
    const aiSummary = `${displayName} requested ${input.servicesRequested
      .map((service) => service.replaceAll("_", " "))
      .join(", ")} for a ${input.eventType.toLowerCase()} on ${input.eventDate} in ${input.city}. ${
      input.venue ? `Venue: ${input.venue}.` : "Venue is not confirmed."
    } ${availabilityStatus === "conflict" ? "The studio already has an active project on this date." : "No active StudioCue project currently conflicts with this date."}`;
    const lead = {
      id: leadId,
      tenantId,
      projectId: null,
      primaryContactId: contactId,
      status: "new",
      eventTypeId: tenantData.defaultEventTypeId ?? "wedding",
      eventTypeLabel: input.eventType,
      eventDate: input.eventDate,
      venue: input.venue,
      city: input.city,
      estimatedGuestCount: input.estimatedGuestCount,
      servicesRequested: input.servicesRequested,
      budgetRange: input.budgetRange,
      referralSource: input.referralSource,
      message: input.message,
      assignedUserId: tenantData.defaultLeadAssigneeId ?? null,
      duplicateKey,
      duplicateOfLeadId: duplicateLead?.id ?? null,
      displayName,
      firstName: input.firstName,
      lastName: input.lastName,
      partnerName: input.partnerName,
      email: input.email,
      phone: input.phone,
      availabilityStatus,
      aiSummary,
      missingInformation,
      suggestedConsultationQuestions,
      consentRecordedAt: timestamp,
      source: input.source,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: systemActor,
      updatedBy: systemActor,
      archivedAt: null,
    };
    batch.create(db.doc(`leads/${leadId}`), lead);
    batch.create(db.doc(`aiJobs/lead_intake_${leadId}`), {
      id: `lead_intake_${leadId}`,
      tenantId,
      projectId: null,
      leadId,
      type: "lead_intake_analysis",
      status: "queued",
      attempts: 0,
      humanApprovalRequired: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    batch.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId,
      actorId: systemActor,
      actorType: "system",
      action: "lead.created",
      entityType: "lead",
      entityId: leadId,
      timestamp,
      before: null,
      after: {
        status: "new",
        eventDate: input.eventDate,
        source: input.source,
        duplicate: Boolean(duplicateLead),
      },
      ipAddress: null,
      userAgent: request.header("user-agent") ?? null,
      correlationId: request.header("x-correlation-id") ?? randomUUID(),
      automationRunId: null,
      providerEventId: null,
    });
    batch.create(db.doc(`emailJobs/inquiry_ack_${leadId}`), {
      id: `inquiry_ack_${leadId}`,
      tenantId,
      projectId: null,
      contactId,
      leadId,
      type: "inquiry_acknowledgement",
      recipient: normalizedEmail,
      recipientName: `${input.firstName} ${input.lastName}`.trim(),
      status: "queued",
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await batch.commit();

    response.status(201).json({
      leadId,
      duplicate: Boolean(duplicateLead),
      availabilityStatus,
      missingInformation: lead.missingInformation,
    });
  },
);
