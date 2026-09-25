import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { applyMessageToConversation } from "../communications/conversation.js";
import {
  BUILDER_LABEL,
  MARKETPLACES,
  normaliseLabel,
  readInquiryEmail,
  type CapturedValues,
  type InquiryEmail,
  type InquiryRead,
  type LeadFieldKey,
} from "./form-email.js";

/**
 * An inquiry email, captured as a lead.
 *
 * One entry point for every way mail reaches StudioCue — the forwarding
 * address today, Microsoft Graph and the Gmail API later — so the reading,
 * the duplicate check and the lead all behave the same whichever door it came
 * through (docs/execution-plan-lead-capture-2026-09-25.md).
 *
 * What it does, in order:
 *  1. reads the email (form-email.ts), with this studio's saved field mapping;
 *  2. drops a sender the studio said is not an inquiry;
 *  3. during a "send a test inquiry" window, records what it read and stops;
 *  4. attaches to an open lead or an active job with the same couple instead of
 *     creating a duplicate;
 *  5. otherwise writes the contact and a fully filled lead, with where each
 *     value came from, and opens the lead's own conversation so replies thread;
 *  6. records the capture either way (inboundCaptures) — the audit of what came
 *     in, what it was read as and what happened, and the source of the
 *     studio's "last captured" health.
 *
 * Idempotent on the provider Message-ID.
 */

export type CaptureRoute = "forward" | "graph" | "gmail";

export type CaptureOutcome =
  | "lead_created"
  | "maybe_created"
  | "attached_to_lead"
  | "attached_to_project"
  | "test"
  | "ignored_not_inquiry"
  | "duplicate";

const OPEN_LEAD_STATUSES = ["new", "reviewing", "qualified", "consultation_scheduled", "proposal_ready"];
const ACTIVE_STATES = ["CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "BOOKED", "PLANNING", "READY"];

type Settings = {
  forms?: Record<string, { fieldMapping?: Record<string, LeadFieldKey | "ignore"> }>;
  inquirySenders?: string[];
  notInquirySenders?: string[];
  testWindowUntil?: string | null;
};

export function formKeyFor(read: Pick<InquiryRead, "builder" | "notificationSender" | "formName">): string {
  return createHash("sha256")
    .update(`${read.builder}|${read.notificationSender}|${(read.formName ?? "").toLowerCase()}`)
    .digest("hex")
    .slice(0, 20);
}

const serviceValues = new Set(["photography", "videography"]);

function stringValue(values: CapturedValues, key: keyof CapturedValues): string | null {
  const value = values[key]?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The lead's view of what was read: its fields plus where each came from. */
export function leadFieldsFrom(read: InquiryRead) {
  const v = read.values;
  const guests = v.guestCount?.value;
  const services = Array.isArray(v.services?.value)
    ? (v.services!.value as string[]).filter((service) => serviceValues.has(service))
    : [];
  const provenance: Record<string, { source: string; label: string | null }> = {};
  for (const [key, captured] of Object.entries(v)) {
    if (captured) provenance[key] = { source: captured.source, label: captured.label ?? null };
  }
  return {
    firstName: stringValue(v, "firstName"),
    lastName: stringValue(v, "lastName"),
    partnerName: stringValue(v, "partnerName"),
    email: stringValue(v, "email")?.toLowerCase() ?? null,
    phone: stringValue(v, "phone"),
    eventDate: stringValue(v, "eventDate"),
    eventTypeLabel: stringValue(v, "eventType"),
    venue: stringValue(v, "venue"),
    city: stringValue(v, "city"),
    ceremonyTime: stringValue(v, "ceremonyTime"),
    estimatedGuestCount: typeof guests === "number" ? guests : null,
    budgetRange: stringValue(v, "budget"),
    referralSource: stringValue(v, "referralSource"),
    servicesRequested: services,
    message: stringValue(v, "message") ?? read.message,
    fieldProvenance: provenance,
  };
}

export function missingInformationFor(fields: ReturnType<typeof leadFieldsFrom>): string[] {
  return [
    ...(fields.email || fields.phone ? [] : ["how to reach them"]),
    ...(fields.eventDate ? [] : ["event date"]),
    ...(fields.venue ? [] : ["venue"]),
    ...(fields.estimatedGuestCount ? [] : ["guest count"]),
  ];
}

export async function captureInquiry(input: {
  db: Firestore;
  tenantId: string;
  email: InquiryEmail;
  providerMessageId: string;
  route: CaptureRoute;
  now: string;
}): Promise<{ outcome: CaptureOutcome; leadId: string | null; projectId: string | null; captureId: string }> {
  const { db, tenantId, now } = input;
  const captureId = `capture_${createHash("sha256")
    .update(`${tenantId}:${input.providerMessageId}`)
    .digest("hex")
    .slice(0, 32)}`;
  const captureReference = db.doc(`inboundCaptures/${captureId}`);
  const [existingCapture, settingsSnapshot] = await Promise.all([
    captureReference.get(),
    db.doc(`leadCaptureSettings/${tenantId}`).get(),
  ]);
  if (existingCapture.exists) {
    return {
      outcome: "duplicate",
      leadId: (existingCapture.get("leadId") as string | null) ?? null,
      projectId: (existingCapture.get("projectId") as string | null) ?? null,
      captureId,
    };
  }
  const settings = (settingsSnapshot.data() ?? {}) as Settings;

  // Read once without a mapping to learn which form it is, then again with
  // that form's saved mapping when the studio has one.
  const first = readInquiryEmail(input.email, {
    today: now.slice(0, 10),
    learnedInquirySenders: settings.inquirySenders,
  });
  const formKey = formKeyFor(first);
  const mapping = settings.forms?.[formKey]?.fieldMapping;
  const read = mapping
    ? readInquiryEmail(input.email, {
        today: now.slice(0, 10),
        studioMapping: mapping,
        learnedInquirySenders: settings.inquirySenders,
      })
    : first;
  const fields = leadFieldsFrom(read);

  const writeCapture = async (
    outcome: CaptureOutcome,
    extra: { leadId?: string | null; projectId?: string | null } = {},
  ) => {
    await captureReference.set({
      id: captureId,
      tenantId,
      route: input.route,
      providerMessageId: input.providerMessageId,
      notificationSender: read.notificationSender,
      subject: input.email.subject.slice(0, 300),
      builder: read.builder,
      builderLabel: read.builderLabel,
      formName: read.formName,
      formKey,
      forwarded: read.forwarded,
      verdict: read.verdict,
      verdictReason: read.verdictReason,
      contactSource: read.contactSource,
      // What was read, for the studio's "teach your form" step and for review.
      fields: read.fields.map((field) => ({
        label: field.label.slice(0, 80),
        normalisedLabel: normaliseLabel(field.label),
        value: field.value.slice(0, 500),
        key: field.key,
      })),
      values: Object.fromEntries(
        Object.entries(read.values).map(([key, captured]) => [
          key,
          { value: captured!.value, source: captured!.source, label: captured!.label ?? null },
        ]),
      ),
      outcome,
      leadId: extra.leadId ?? null,
      projectId: extra.projectId ?? null,
      receivedAt: now,
      createdAt: now,
    });
  };

  if ((settings.notInquirySenders ?? []).includes(read.notificationSender)) {
    await writeCapture("ignored_not_inquiry");
    return { outcome: "ignored_not_inquiry", leadId: null, projectId: null, captureId };
  }
  if (settings.testWindowUntil && settings.testWindowUntil > now) {
    await writeCapture("test");
    await db.doc(`leadCaptureSettings/${tenantId}`).set(
      { tenantId, lastTestCaptureId: captureId, lastTestCaptureAt: now, testWindowUntil: null, updatedAt: now },
      { merge: true },
    );
    return { outcome: "test", leadId: null, projectId: null, captureId };
  }

  // Already know them? Attach rather than duplicate.
  if (fields.email) {
    const [openLeads, contacts] = await Promise.all([
      db
        .collection("leads")
        .where("tenantId", "==", tenantId)
        .where("email", "==", fields.email)
        .limit(10)
        .get(),
      db
        .collection("contacts")
        .where("tenantId", "==", tenantId)
        .where("normalizedEmail", "==", fields.email)
        .limit(5)
        .get(),
    ]);
    const openLead = openLeads.docs.find(
      (lead) => OPEN_LEAD_STATUSES.includes(String(lead.get("status"))) && !lead.get("archivedAt"),
    );
    if (openLead) {
      await attachMessage(db, {
        tenantId,
        leadId: openLead.id,
        projectId: null,
        read,
        fields,
        subject: input.email.subject,
        providerMessageId: input.providerMessageId,
        now,
      });
      await openLead.ref.update({
        inquiryCount: Number(openLead.get("inquiryCount") ?? 1) + 1,
        lastInquiryAt: now,
        updatedAt: now,
        updatedBy: "inquiry-capture",
      });
      await writeCapture("attached_to_lead", { leadId: openLead.id });
      return { outcome: "attached_to_lead", leadId: openLead.id, projectId: null, captureId };
    }
    for (const contact of contacts.docs) {
      const projects = await db
        .collection("projects")
        .where("tenantId", "==", tenantId)
        .where("clientContactIds", "array-contains", contact.id)
        .limit(10)
        .get();
      const active = projects.docs.find(
        (project) => ACTIVE_STATES.includes(String(project.get("state"))) && !project.get("archivedAt"),
      );
      if (active) {
        await attachMessage(db, {
          tenantId,
          leadId: null,
          projectId: active.id,
          read,
          fields,
          subject: input.email.subject,
          providerMessageId: input.providerMessageId,
          now,
        });
        await writeCapture("attached_to_project", { projectId: active.id });
        return { outcome: "attached_to_project", leadId: null, projectId: active.id, captureId };
      }
    }
  }

  const leadId = await writeLead(db, {
    tenantId,
    read,
    fields,
    subject: input.email.subject,
    providerMessageId: input.providerMessageId,
    captureId,
    route: input.route,
    now,
  });
  await attachMessage(db, {
    tenantId,
    leadId,
    projectId: null,
    read,
    fields,
    subject: input.email.subject,
    providerMessageId: input.providerMessageId,
    now,
  });
  const outcome: CaptureOutcome = read.verdict === "inquiry" ? "lead_created" : "maybe_created";
  await writeCapture(outcome, { leadId });
  await db.doc(`leadCaptureSettings/${tenantId}`).set(
    { tenantId, lastCaptureAt: now, lastCaptureId: captureId, updatedAt: now },
    { merge: true },
  );
  return { outcome, leadId, projectId: null, captureId };
}

async function writeLead(
  db: Firestore,
  input: {
    tenantId: string;
    read: InquiryRead;
    fields: ReturnType<typeof leadFieldsFrom>;
    subject: string;
    providerMessageId: string;
    captureId: string;
    route: CaptureRoute;
    now: string;
  },
): Promise<string> {
  const { tenantId, read, fields, now } = input;
  const leadId = `lead_cap_${createHash("sha256")
    .update(`${tenantId}:${input.providerMessageId}`)
    .digest("hex")
    .slice(0, 28)}`;
  const [contactResult, dateConflicts, tenant] = await Promise.all([
    fields.email
      ? db
          .collection("contacts")
          .where("tenantId", "==", tenantId)
          .where("normalizedEmail", "==", fields.email)
          .where("archivedAt", "==", null)
          .limit(1)
          .get()
      : null,
    fields.eventDate
      ? db
          .collection("projects")
          .where("tenantId", "==", tenantId)
          .where("eventDate", "==", fields.eventDate)
          .where("state", "in", ACTIVE_STATES)
          .limit(1)
          .get()
      : null,
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  const displayName =
    [fields.firstName, fields.lastName].filter(Boolean).join(" ") +
      (fields.partnerName ? ` & ${fields.partnerName}` : "") ||
    fields.email ||
    "New inquiry";
  const existingContact = contactResult?.docs[0];
  const contactId = fields.email ? (existingContact?.id ?? randomUUID()) : null;
  const availabilityStatus = !fields.eventDate ? "unknown" : dateConflicts?.empty ? "available" : "conflict";
  const marketplace = MARKETPLACES.has(read.builder);
  const source = read.builder === "unknown" ? "forwarded_email" : marketplace ? `marketplace_${read.builder}` : "website_form";
  const actor = "inquiry-capture";
  const tenantData = tenant.data() as { defaultLeadAssigneeId?: string; defaultEventTypeId?: string } | undefined;
  const batch = db.batch();
  if (contactId && !existingContact) {
    batch.create(db.doc(`contacts/${contactId}`), {
      id: contactId,
      tenantId,
      firstName: fields.firstName ?? displayName,
      lastName: fields.lastName ?? "",
      displayName,
      email: fields.email,
      normalizedEmail: fields.email,
      phone: fields.phone,
      normalizedPhone: fields.phone?.replace(/\D/g, "") ?? "",
      company: null,
      contactTypes: ["prospect"],
      projectIds: [],
      portalUserId: null,
      marketingConsent: false,
      notes: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
      archivedAt: null,
    });
  }
  batch.create(db.doc(`leads/${leadId}`), {
    id: leadId,
    tenantId,
    projectId: null,
    primaryContactId: contactId,
    status: "new",
    // An inquiry the reader wasn't sure about waits for the studio to say so.
    needsConfirmation: read.verdict !== "inquiry",
    eventTypeId: tenantData?.defaultEventTypeId ?? "wedding",
    eventTypeLabel: fields.eventTypeLabel ?? "Wedding",
    eventDate: fields.eventDate,
    venue: fields.venue,
    city: fields.city,
    ceremonyTime: fields.ceremonyTime,
    estimatedGuestCount: fields.estimatedGuestCount,
    servicesRequested: fields.servicesRequested.length ? fields.servicesRequested : ["photography"],
    budgetRange: fields.budgetRange,
    referralSource: fields.referralSource ?? (marketplace ? BUILDER_LABEL[read.builder] : null),
    message: fields.message,
    assignedUserId: tenantData?.defaultLeadAssigneeId ?? null,
    duplicateKey: `${fields.email ?? ""}||${fields.eventDate ?? ""}`,
    duplicateOfLeadId: null,
    displayName,
    firstName: fields.firstName,
    lastName: fields.lastName,
    partnerName: fields.partnerName,
    email: fields.email,
    phone: fields.phone,
    availabilityStatus,
    aiSummary: null,
    missingInformation: missingInformationFor(fields),
    suggestedConsultationQuestions: [],
    consentRecordedAt: null,
    source,
    formBuilder: read.builder,
    formBuilderLabel: read.builderLabel,
    formName: read.formName,
    captureRoute: input.route,
    captureId: input.captureId,
    fieldProvenance: fields.fieldProvenance,
    rawFormFields: read.fields.map((field) => ({ label: field.label.slice(0, 80), value: field.value.slice(0, 500) })),
    // The model fills only what is still empty, in the lead intake job.
    enrichmentPending: true,
    inquiryCount: 1,
    lastInquiryAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
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
    actorId: actor,
    actorType: "system",
    action: "lead.captured",
    entityType: "lead",
    entityId: leadId,
    timestamp: now,
    before: null,
    after: {
      status: "new",
      source,
      builder: read.builder,
      verdict: read.verdict,
      eventDate: fields.eventDate,
      contactSource: read.contactSource,
    },
    ipAddress: null,
    userAgent: null,
    correlationId: input.providerMessageId,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return leadId;
}

/**
 * The inquiry itself, as the first message on the lead's (or job's) thread, so
 * the studio's reply and the couple's answer sit together in StudioCue.
 */
async function attachMessage(
  db: Firestore,
  input: {
    tenantId: string;
    leadId: string | null;
    projectId: string | null;
    read: InquiryRead;
    fields: ReturnType<typeof leadFieldsFrom>;
    subject: string;
    providerMessageId: string;
    now: string;
  },
) {
  const participant = {
    contactId: null,
    email: input.fields.email,
    phone: input.fields.phone,
    name: [input.fields.firstName, input.fields.lastName].filter(Boolean).join(" ") || null,
  };
  const conversationId = await applyMessageToConversation(db, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    leadId: input.leadId,
    participant,
    channel: "email",
    direction: "inbound",
    subject: input.subject || null,
    preview: input.fields.message.slice(0, 280),
    occurredAt: input.now,
  });
  const messageId = `inquiry_${createHash("sha256")
    .update(`${conversationId}:${input.providerMessageId}`)
    .digest("hex")
    .slice(0, 32)}`;
  await db.doc(`messages/${messageId}`).set(
    {
      id: messageId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      leadId: input.leadId,
      conversationId,
      direction: "inbound",
      channel: "email",
      visibility: "shared",
      subject: input.subject || null,
      body: input.fields.message,
      bodyPreview: input.fields.message.slice(0, 280),
      provider: "inquiry_capture",
      providerMessageId: input.providerMessageId,
      senderEmail: input.fields.email,
      senderName: participant.name,
      formBuilder: input.read.builder,
      status: "received",
      receivedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: "inquiry-capture",
      updatedBy: "inquiry-capture",
      archivedAt: null,
    },
    { merge: true },
  );
  if (input.leadId) {
    await db.doc(`leads/${input.leadId}`).set({ conversationId }, { merge: true });
  }
  return conversationId;
}
