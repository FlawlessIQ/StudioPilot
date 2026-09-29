import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { plausiblePersonName } from "./form-email.js";
import { moveLeadThreadsToProject } from "./lead-thread.js";

/**
 * An inquiry becomes a job the moment it is one.
 *
 * Before this, a website or inbox inquiry stayed a `lead` until the studio
 * pressed Convert — and everything useful (a consultation, a booking link,
 * package matching, one thread from the first message) only worked on a job.
 * So the lead was a waiting room the studio had to leave by hand before
 * anything could happen (docs/lead-management-plan-2026-09-28.md, "The model").
 *
 * A lead converts automatically when it is a confirmed inquiry (not held in
 * "Maybe an inquiry") and it has a date, because every job carries one. A lead
 * without a date waits: whatever supplies the date later calls this again.
 *
 * The job is created in LEAD, marked `origin: "inquiry"`, and is quiet by
 * construction: every client-facing scheduler and automation acts only from
 * BOOKED onward (audited for this change), and the job appears under
 * Inquiries, not Jobs, until it is booked.
 *
 * Idempotent: the job's id derives from the lead's, and a lead that already
 * has a job returns it.
 */

export const PRE_BOOKING_STATES = [
  "LEAD",
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
] as const;

const ACTOR = "inquiry-capture";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function hashedUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The job an inquiry becomes, by id — the same every time for the same lead. */
export function projectIdForLead(tenantId: string, leadId: string): string {
  return hashedUuid(`inquiry-project:${tenantId}:${leadId}`);
}

function contactIdForLead(tenantId: string, leadId: string): string {
  return hashedUuid(`inquiry-contact:${tenantId}:${leadId}`);
}

export type ConversionResult =
  | { converted: true; projectId: string; created: boolean }
  | { converted: false; reason: "missing" | "needs_confirmation" | "closed" | "no_date" };

export async function convertInquiryToJob(
  db: Firestore,
  input: { tenantId: string; leadId: string; now: string; actor?: string },
): Promise<ConversionResult> {
  const actor = input.actor ?? ACTOR;
  const leadReference = db.doc(`leads/${input.leadId}`);
  const result = await db.runTransaction(async (transaction): Promise<ConversionResult> => {
    const lead = await transaction.get(leadReference);
    if (!lead.exists || lead.get("tenantId") !== input.tenantId) {
      return { converted: false, reason: "missing" };
    }
    const existingProjectId = text(lead.get("projectId"));
    if (existingProjectId) return { converted: true, projectId: existingProjectId, created: false };
    if (lead.get("needsConfirmation") === true) return { converted: false, reason: "needs_confirmation" };
    if (["lost", "archived"].includes(text(lead.get("status"))) || lead.get("archivedAt")) {
      return { converted: false, reason: "closed" };
    }
    const eventDate = text(lead.get("eventDate"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return { converted: false, reason: "no_date" };

    const tenant = await transaction.get(db.doc(`tenants/${input.tenantId}`));
    const email = text(lead.get("email")).toLowerCase() || null;

    // The couple's contact: the one the lead already names, else one with the
    // same email, else a new prospect made from what they told us.
    let contactId = text(lead.get("primaryContactId")) || null;
    let contactExists = false;
    if (contactId) {
      const named = await transaction.get(db.doc(`contacts/${contactId}`));
      contactExists = named.exists && named.get("tenantId") === input.tenantId && !named.get("archivedAt");
      if (!contactExists) contactId = null;
    }
    if (!contactId && email) {
      const byEmail = await transaction.get(
        db
          .collection("contacts")
          .where("tenantId", "==", input.tenantId)
          .where("normalizedEmail", "==", email)
          .where("archivedAt", "==", null)
          .limit(1),
      );
      if (!byEmail.empty) {
        contactId = byEmail.docs[0]!.id;
        contactExists = true;
      }
    }
    if (!contactId) {
      contactId = contactIdForLead(input.tenantId, input.leadId);
      const deterministic = await transaction.get(db.doc(`contacts/${contactId}`));
      contactExists = deterministic.exists;
    }

    // The job is named after this. A lead written before the form reader
    // learned Gmail's `*Label* value` lines can carry a phone number as its
    // name; a job called that is worse than one called by the couple's email.
    const namedAs = (value: string) =>
      value && value.split(/\s+&\s+/).every((part) => plausiblePersonName(part)) ? value : "";
    const displayName =
      namedAs(text(lead.get("displayName"))) ||
      namedAs([text(lead.get("firstName")), text(lead.get("lastName"))].filter(Boolean).join(" ")) ||
      email ||
      "New inquiry";
    const eventTypeLabel = text(lead.get("eventTypeLabel")) || text(lead.get("eventType")) || "Wedding";
    const projectId = projectIdForLead(input.tenantId, input.leadId);
    const projectReference = db.doc(`projects/${projectId}`);
    const existingProject = await transaction.get(projectReference);

    if (!contactExists) {
      const firstName = namedAs(text(lead.get("firstName"))) || displayName.split(/\s+/)[0] || "Client";
      transaction.create(db.doc(`contacts/${contactId}`), {
        id: contactId,
        tenantId: input.tenantId,
        firstName,
        lastName: text(lead.get("lastName")),
        displayName,
        email,
        normalizedEmail: email,
        phone: text(lead.get("phone")) || null,
        normalizedPhone: text(lead.get("phone")).replace(/\D/g, ""),
        company: null,
        // A prospect until they book: booking promotes them to client
        // (contacts/promotion.ts).
        contactTypes: ["prospect"],
        projectIds: [projectId],
        portalUserId: null,
        marketingConsent: false,
        notes: null,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: actor,
        updatedBy: actor,
        archivedAt: null,
      });
    } else {
      transaction.update(db.doc(`contacts/${contactId}`), {
        projectIds: FieldValue.arrayUnion(projectId),
        updatedAt: input.now,
        updatedBy: actor,
      });
    }

    if (!existingProject.exists) {
      transaction.create(projectReference, {
        id: projectId,
        projectId,
        tenantId: input.tenantId,
        name: `${displayName} ${eventTypeLabel}`.trim().slice(0, 160),
        eventTypeId: text(lead.get("eventTypeId")) || eventTypeLabel.toLowerCase(),
        eventType: eventTypeLabel,
        eventDate,
        timezone: text(tenant.get("timezone")) || "America/New_York",
        clientContactIds: [contactId],
        leadPhotographerId: null,
        leadId: input.leadId,
        venueName: text(lead.get("venue")) || null,
        city: text(lead.get("city")) || null,
        venue: null,
        // Where this job came from: an inquiry that became one on arrival,
        // not a booking someone entered. Inquiries, not Jobs, until booked.
        origin: "inquiry",
        state: "LEAD",
        stateVersion: 0,
        packageSnapshotId: null,
        readinessScore: 0,
        nextAction: "Reply to the inquiry",
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: actor,
        updatedBy: actor,
        archivedAt: null,
      });
      const auditId = `audit_inquiry_job_${projectId}`;
      transaction.set(db.doc(`auditEvents/${auditId}`), {
        id: auditId,
        tenantId: input.tenantId,
        projectId,
        actorId: actor,
        actorType: "system",
        action: "project.created",
        entityType: "project",
        entityId: projectId,
        timestamp: input.now,
        before: null,
        after: { state: "LEAD", eventDate, origin: "inquiry", leadId: input.leadId },
        ipAddress: null,
        userAgent: null,
        correlationId: input.leadId,
        automationRunId: null,
        providerEventId: null,
      });
    }

    transaction.update(leadReference, {
      projectId,
      primaryContactId: contactId,
      status: "converted",
      convertedAt: input.now,
      convertedBy: actor,
      autoConverted: true,
      updatedAt: input.now,
      updatedBy: actor,
    });
    const conversionAuditId = `audit_inquiry_converted_${input.leadId}`;
    transaction.set(db.doc(`auditEvents/${conversionAuditId}`), {
      id: conversionAuditId,
      tenantId: input.tenantId,
      projectId,
      actorId: actor,
      actorType: "system",
      action: "lead.converted",
      entityType: "lead",
      entityId: input.leadId,
      timestamp: input.now,
      before: { status: text(lead.get("status")) || "new" },
      after: { status: "converted", projectId, automatic: true },
      ipAddress: null,
      userAgent: null,
      correlationId: input.leadId,
      automationRunId: null,
      providerEventId: null,
    });
    return { converted: true, projectId, created: !existingProject.exists };
  });

  if (result.converted) await afterConversion(db, { ...input, projectId: result.projectId });
  return result;
}

/**
 * What follows a conversion, whoever converted: the lead's thread and any
 * reply already drafted for it move onto the job, so the couple's first
 * message, the studio's reply and the draft are all in one place.
 *
 * Outside the transaction, and each step safe to repeat.
 */
export async function afterConversion(
  db: Firestore,
  input: { tenantId: string; leadId: string; projectId: string; now: string },
): Promise<void> {
  try {
    await moveLeadThreadsToProject(db, input);
  } catch (caught: unknown) {
    console.warn(`[intake] moving the lead thread onto the job failed: ${String(caught).slice(0, 160)}`);
  }
  const drafts = await db
    .collection("aiActions")
    .where("tenantId", "==", input.tenantId)
    .where("structuredOutput.leadId", "==", input.leadId)
    .limit(20)
    .get()
    .catch(() => null);
  for (const draft of drafts?.docs ?? []) {
    if (draft.get("projectId")) continue;
    await draft.ref.update({ projectId: input.projectId, updatedAt: input.now }).catch(() => undefined);
  }
}
