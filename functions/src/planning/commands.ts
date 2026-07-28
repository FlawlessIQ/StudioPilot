import { createHash, randomBytes } from "node:crypto";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const item = z.object({
  id: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  title: z.string().min(1),
  description: z.string(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  travelMinutes: z.number().int().nonnegative(),
  photographerIds: z.array(z.string()),
  participants: z.array(z.string()),
  vendorContactIds: z.array(z.string()),
  equipment: z.array(z.string()),
  notes: z.string().nullable(),
  visibility: z.enum(["studio", "client", "crew", "shared"]),
  blockingIssues: z.array(z.string()),
});
const questionnaireField = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
  type: z.enum([
    "text",
    "long_text",
    "email",
    "phone",
    "date",
    "time",
    "address",
    "dropdown",
    "multi_select",
    "radio",
    "checkbox",
    "file",
    "contact",
    "repeating_group",
    "acknowledgement",
    "information",
  ]),
  required: z.boolean(),
  locked: z.boolean(),
  internalOnly: z.boolean(),
  options: z.array(z.string()),
  conditionalOn: z
    .object({ fieldId: z.string(), equals: z.unknown() })
    .nullable(),
});
const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("saveQuestionnaire"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      responseId: z.string(),
      projectId: z.string(),
      answers: z.record(z.string(), z.unknown()),
      submit: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("createQuestionnaireTemplate"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      name: z.string().min(2).max(160),
      eventTypeId: z.string().min(1),
      status: z.enum(["draft", "active"]),
      sections: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1).max(160),
            fields: z.array(questionnaireField).min(1),
          }),
        )
        .min(1),
      dueDaysBeforeEvent: z.number().int().nonnegative().max(365),
      reminderDaysBeforeDue: z.array(z.number().int().nonnegative().max(365)),
    }),
  }),
  z.object({
    type: z.literal("assignQuestionnaire"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      templateId: z.string(),
    }),
  }),
  z.object({
    type: z.literal("createVendor"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      company: z.string().min(1),
      contactName: z.string(),
      email: z.string().email().nullable(),
      type: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("createCoiRequest"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      certificateHolder: z.string().min(2).max(300),
      venueLegalName: z.string().min(2).max(300),
      venueAddress: z.string().min(5).max(500),
      eventDate: z.string().date(),
      coverageTypes: z.array(z.string().min(1)).min(1),
      requiredLimits: z.record(z.string(), z.number().nonnegative()),
      additionalInsuredWording: z.string().max(2000).nullable(),
      waiverOfSubrogation: z.boolean(),
      primaryNoncontributory: z.boolean(),
      specialInstructions: z.string().max(3000).nullable(),
      submissionEmail: z.string().email(),
      dueDate: z.string().date(),
      insuranceAgentEmail: z.string().email(),
    }),
  }),
  z.object({
    type: z.literal("decideCoi"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      requestId: z.string(),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().min(5),
    }),
  }),
  z.object({
    type: z.literal("publishSchedule"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      timezone: z.string(),
      items: z.array(item).min(1),
      coverageMinutes: z.number().int().positive(),
    }),
  }),
  z.object({
    type: z.literal("approveSchedule"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      scheduleId: z.string(),
      decision: z.enum(["approved", "changes_requested"]),
      notes: z.string().max(2000),
    }),
  }),
  z.object({
    type: z.literal("sendCoiToVenue"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      requestId: z.string(),
    }),
  }),
]);
const internalRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
]);
function stable(scope: string, tenantId: string, key: string) {
  return `${scope}_${createHash("sha256").update(`${tenantId}:${key}`).digest("hex").slice(0, 32)}`;
}

export const planningCommand = onRequest(
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
      const identity = await requireIdentity(request);
      const parsed = command.parse(request.body);
      const db = getFirestore();
      const membership = await db
        .doc(`memberships/${parsed.tenantId}_${identity.uid}`)
        .get();
      if (!membership.exists || membership.get("status") !== "active")
        throw new Error("FORBIDDEN");
      const role = String(membership.get("role"));
      const projectIds = membership.get("projectIds") as unknown;
      const projectId =
        "projectId" in parsed.input ? parsed.input.projectId : null;
      if (
        !["studio_owner", "studio_admin"].includes(role) &&
        (!projectId ||
          !Array.isArray(projectIds) ||
          !projectIds.includes(projectId))
      )
        throw new Error("FORBIDDEN");
      const execution = db.doc(
        `commandExecutions/${stable("planning", parsed.tenantId, parsed.idempotencyKey)}`,
      );
      const prior = await execution.get();
      if (prior.exists) {
        response.status(200).json(prior.get("result"));
        return;
      }
      const now = new Date().toISOString();
      let result: Record<string, unknown>;
      if (parsed.type === "saveQuestionnaire") {
        const reference = db.doc(
          `questionnaireResponses/${parsed.input.responseId}`,
        );
        const snapshot = await reference.get();
        if (
          !snapshot.exists ||
          snapshot.get("tenantId") !== parsed.tenantId ||
          snapshot.get("projectId") !== parsed.input.projectId
        )
          throw new Error("RESPONSE_NOT_FOUND");
        await reference.update({
          answers: parsed.input.answers,
          status: parsed.input.submit ? "submitted" : "in_progress",
          completionPercent: parsed.input.submit
            ? 100
            : snapshot.get("completionPercent"),
          submittedAt: parsed.input.submit ? now : null,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          responseId: parsed.input.responseId,
          status: parsed.input.submit ? "submitted" : "in_progress",
        };
      } else if (parsed.type === "createQuestionnaireTemplate") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const versions = await db
          .collection("questionnaireTemplates")
          .where("tenantId", "==", parsed.tenantId)
          .where("name", "==", parsed.input.name)
          .get();
        const version =
          Math.max(0, ...versions.docs.map((item) => Number(item.get("version")))) +
          1;
        const id = stable(
          "questionnaire_template",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const batch = db.batch();
        if (parsed.input.status === "active") {
          for (const priorTemplate of versions.docs) {
            if (priorTemplate.get("status") === "active")
              batch.update(priorTemplate.ref, {
                status: "archived",
                archivedAt: now,
                updatedAt: now,
                updatedBy: identity.uid,
              });
          }
        }
        batch.create(db.doc(`questionnaireTemplates/${id}`), {
          id,
          tenantId: parsed.tenantId,
          ...parsed.input,
          version,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        await batch.commit();
        result = { templateId: id, version, status: parsed.input.status };
      } else if (parsed.type === "assignQuestionnaire") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const [project, template] = await Promise.all([
          db.doc(`projects/${parsed.input.projectId}`).get(),
          db.doc(`questionnaireTemplates/${parsed.input.templateId}`).get(),
        ]);
        if (
          !project.exists ||
          project.get("tenantId") !== parsed.tenantId ||
          !template.exists ||
          template.get("tenantId") !== parsed.tenantId ||
          template.get("status") !== "active"
        )
          throw new Error("QUESTIONNAIRE_ASSIGNMENT_INVALID");
        const due = new Date(`${String(project.get("eventDate"))}T12:00:00.000Z`);
        due.setUTCDate(
          due.getUTCDate() - Number(template.get("dueDaysBeforeEvent") ?? 0),
        );
        const id = stable(
          "questionnaire_response",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        await db.doc(`questionnaireResponses/${id}`).create({
          id,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          templateId: parsed.input.templateId,
          templateVersion: Number(template.get("version")),
          templateName: String(template.get("name")),
          status: "not_started",
          answers: {},
          completionPercent: 0,
          dueDate: due.toISOString().slice(0, 10),
          submittedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        result = { responseId: id, status: "not_started" };
      } else if (parsed.type === "createVendor") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const id = stable("vendor", parsed.tenantId, parsed.idempotencyKey);
        await db
          .doc(`vendors/${id}`)
          .create({
            id,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            projectIds: [parsed.input.projectId],
            company: parsed.input.company,
            contactName: parsed.input.contactName,
            email: parsed.input.email,
            phone: null,
            type: parsed.input.type,
            website: null,
            address: null,
            notes: null,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
        result = { vendorId: id };
      } else if (parsed.type === "createCoiRequest") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const requirementId = stable(
          "coi_requirement",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const requestId = stable(
          "coi_request",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const token = randomBytes(32).toString("base64url");
        const replyDomain = process.env.SENDGRID_INBOUND_DOMAIN;
        if (!replyDomain) throw new Error("COI_INBOUND_DOMAIN_NOT_CONFIGURED");
        const replyAddress = `coi+${token}@${replyDomain}`;
        const batch = db.batch();
        batch.create(db.doc(`insuranceRequirements/${requirementId}`), {
          id: requirementId,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          status: "requested",
          certificateHolder: parsed.input.certificateHolder,
          venueLegalName: parsed.input.venueLegalName,
          venueAddress: parsed.input.venueAddress,
          eventDate: parsed.input.eventDate,
          coverageTypes: parsed.input.coverageTypes,
          requiredLimits: parsed.input.requiredLimits,
          additionalInsuredWording: parsed.input.additionalInsuredWording,
          waiverOfSubrogation: parsed.input.waiverOfSubrogation,
          primaryNoncontributory: parsed.input.primaryNoncontributory,
          specialInstructions: parsed.input.specialInstructions,
          submissionEmail: parsed.input.submissionEmail,
          dueDate: parsed.input.dueDate,
          approvedAt: null,
          approvedBy: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        batch.create(db.doc(`insuranceRequests/${requestId}`), {
          id: requestId,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          requirementId,
          status: "requested",
          replyTokenHash: createHash("sha256").update(token).digest("hex"),
          requestEmail: parsed.input.insuranceAgentEmail,
          venueName: parsed.input.venueLegalName,
          dueDate: parsed.input.dueDate,
          inboundMessageId: null,
          documentId: null,
          extractedData: null,
          discrepancies: [],
          humanDecision: "pending",
          requestedAt: now,
          receivedAt: null,
          sentToVenueAt: null,
          venueAcknowledgedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        batch.create(db.doc(`emailJobs/coi_request_${requestId}`), {
          id: `coi_request_${requestId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          type: "coi_request",
          requestId,
          recipient: parsed.input.insuranceAgentEmail,
          replyAddress,
          requirement: {
            certificateHolder: parsed.input.certificateHolder,
            venueLegalName: parsed.input.venueLegalName,
            venueAddress: parsed.input.venueAddress,
            eventDate: parsed.input.eventDate,
            coverageTypes: parsed.input.coverageTypes,
            requiredLimits: parsed.input.requiredLimits,
            dueDate: parsed.input.dueDate,
          },
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        batch.create(db.doc(`auditEvents/coi_request_${requestId}`), {
          id: `coi_request_${requestId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          actorType: "user",
          action: "coi.requested",
          entityType: "insuranceRequest",
          entityId: requestId,
          timestamp: now,
          before: null,
          after: { status: "requested", requirementId },
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: parsed.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        await batch.commit();
        result = { requestId, requirementId, status: "requested" };
      } else if (parsed.type === "decideCoi") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const reference = db.doc(`insuranceRequests/${parsed.input.requestId}`);
        let currentRequest: DocumentData | null = null;
        await db.runTransaction(async (tx) => {
          const current = await tx.get(reference);
          if (
            !current.exists ||
            current.get("tenantId") !== parsed.tenantId ||
            current.get("projectId") !== parsed.input.projectId ||
            !["under_review", "correction_required"].includes(
              String(current.get("status")),
            )
            )
            throw new Error("COI_NOT_REVIEWABLE");
          currentRequest = current.data() ?? null;
          tx.update(reference, {
            status:
              parsed.input.decision === "approved"
                ? "approved"
                : "correction_required",
            humanDecision: parsed.input.decision,
            decisionReason: parsed.input.reason,
            decidedAt: now,
            decidedBy: identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        });
        const reviewed = currentRequest as DocumentData | null;
        if (parsed.input.decision === "rejected" && reviewed) {
          await db.doc(`emailJobs/coi_correction_${parsed.input.requestId}`).set({
            id: `coi_correction_${parsed.input.requestId}`,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            type: "coi_correction",
            requestId: parsed.input.requestId,
            recipient: reviewed.requestEmail,
            reason: parsed.input.reason,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (parsed.input.decision === "approved" && reviewed) {
          const documentId = `coi_${parsed.input.requestId}`;
          const object = String(reviewed.temporaryObject ?? "");
          if (!object.startsWith("gs://")) throw new Error("COI_DOCUMENT_MISSING");
          await db.doc(`documents/${documentId}`).set({
            id: documentId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            provider: "cloud_storage",
            providerFileId: object,
            providerRevision: null,
            canonicalPath: object,
            name: String(reviewed.sourceFilename ?? "certificate-of-insurance.pdf"),
            contentType: "application/pdf",
            sizeBytes: null,
            hash: null,
            visibility: "studio",
            category: "coi",
            status: "approved",
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          await reference.update({ documentId });
          await db.doc(`providerJobs/dropbox_coi_${parsed.input.requestId}`).set({
            id: `dropbox_coi_${parsed.input.requestId}`,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            type: "upload_dropbox_document",
            documentId,
            targetFolder: "05_COI",
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        result = {
          requestId: parsed.input.requestId,
          decision: parsed.input.decision,
        };
      } else if (parsed.type === "sendCoiToVenue") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const reference = db.doc(`insuranceRequests/${parsed.input.requestId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("projectId") !== parsed.input.projectId ||
          current.get("status") !== "approved" ||
          !current.get("documentId")
        )
          throw new Error("COI_NOT_APPROVED");
        const requirement = await db
          .doc(`insuranceRequirements/${String(current.get("requirementId"))}`)
          .get();
        if (!requirement.exists) throw new Error("COI_REQUIREMENT_NOT_FOUND");
        await db.doc(`emailJobs/coi_venue_${parsed.input.requestId}`).create({
          id: `coi_venue_${parsed.input.requestId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          type: "coi_venue_delivery",
          requestId: parsed.input.requestId,
          documentId: current.get("documentId"),
          recipient: requirement.get("submissionEmail"),
          venueName: requirement.get("venueLegalName"),
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        await reference.update({
          status: "sent_to_venue",
          sentToVenueAt: now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = { requestId: parsed.input.requestId, status: "sent_to_venue" };
      } else if (parsed.type === "publishSchedule") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const schedules = await db
          .collection("schedules")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .orderBy("version", "desc")
          .limit(1)
          .get();
        const priorSchedule = schedules.docs[0];
        const version = Number(priorSchedule?.get("version") ?? 0) + 1;
        const id = stable("schedule", parsed.tenantId, parsed.idempotencyKey);
        const acceptedAssignments = await db
          .collection("crewAssignments")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .where("status", "==", "accepted")
          .get();
        const batch = db.batch();
        if (priorSchedule)
          batch.update(priorSchedule.ref, {
            status: "superseded",
            updatedAt: now,
            updatedBy: identity.uid,
          });
        batch.create(db.doc(`schedules/${id}`), {
          id,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          version,
          status: "published",
          timezone: parsed.input.timezone,
          items: parsed.input.items,
          approvalState: "client_pending",
          publishedAt: now,
          approvedBy: null,
          pdfDocumentId: null,
          dropboxDocumentId: null,
          supersedesId: priorSchedule?.id ?? null,
          immutable: true,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        batch.create(db.doc(`pdfJobs/schedule_${id}`), {
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          scheduleId: id,
          type: "schedule_pdf",
          status: "queued",
          createdAt: now,
        });
        for (const assignment of acceptedAssignments.docs) {
          batch.update(assignment.ref, {
            currentScheduleId: id,
            currentScheduleVersion: version,
            acknowledgedScheduleVersion: null,
            scheduleAcknowledgedAt: null,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        }
        await batch.commit();
        result = {
          scheduleId: id,
          version,
          acknowledgementReset: true,
          crewNotified: acceptedAssignments.size,
        };
      } else {
        const reference = db.doc(`schedules/${parsed.input.scheduleId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("projectId") !== parsed.input.projectId
        )
          throw new Error("SCHEDULE_NOT_FOUND");
        await reference.update({
          approvalState:
            parsed.input.decision === "approved"
              ? "client_approved"
              : "changes_requested",
          status: parsed.input.decision,
          approvedBy:
            parsed.input.decision === "approved" ? identity.uid : null,
          approvalNotes: parsed.input.notes,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          scheduleId: parsed.input.scheduleId,
          decision: parsed.input.decision,
        };
      }
      await execution.create({
        tenantId: parsed.tenantId,
        result,
        createdAt: now,
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "PLANNING_COMMAND_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
