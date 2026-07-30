import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { consumeAiQuota } from "../saas/usage.js";

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("scheduleConsultation"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      contactId: z.string().min(1),
      mode: z.enum(["zoom", "in_person", "phone", "custom"]),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      timezone: z.string().min(1),
      location: z.string().max(500).nullable(),
    }),
  }),
  z.object({
    type: z.literal("completeConsultation"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      consultationId: z.string().min(1),
      notes: z.string().trim().min(20).max(20_000),
    }),
  }),
  z.object({
    type: z.literal("createEnvelope"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      proposalId: z.string().min(1),
      templateId: z.string().min(1),
      signers: z
        .array(
          z.object({
            name: z.string().min(1),
            email: z.string().email(),
            role: z.string().min(1),
            order: z.number().int().positive(),
          }),
        )
        .min(1),
    }),
  }),
  z.object({
    type: z.literal("createRetainerInvoice"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      packageSnapshotId: z.string().min(1),
      customerId: z.string().min(1).nullable().default(null),
      dueDate: z.string().date(),
    }),
  }),
  z.object({
    type: z.literal("runBookingGate"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      expectedProjectVersion: z.number().int().nonnegative(),
      approvedRetainerExceptionId: z.string().nullable(),
    }),
  }),
]);

const permittedRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
]);

function stableId(
  scope: string,
  tenantId: string,
  idempotencyKey: string,
): string {
  return `${scope}_${createHash("sha256").update(`${tenantId}:${idempotencyKey}`).digest("hex").slice(0, 32)}`;
}

async function membershipFor(tenantId: string, userId: string) {
  const snapshot = await getFirestore()
    .doc(`memberships/${tenantId}_${userId}`)
    .get();
  if (
    !snapshot.exists ||
    snapshot.get("status") !== "active" ||
    !permittedRoles.has(String(snapshot.get("role")))
  ) {
    throw new Error("FORBIDDEN");
  }
  return snapshot.data() ?? {};
}

function assertProjectAccess(
  membership: Record<string, unknown>,
  projectId: string,
) {
  const role = String(membership.role);
  if (role === "studio_owner" || role === "studio_admin") return;
  const projectIds = Array.isArray(membership.projectIds)
    ? membership.projectIds
    : [];
  if (!projectIds.includes(projectId)) throw new Error("FORBIDDEN");
}

export const bookingCommand = onRequest(
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
      const command = commandSchema.parse(request.body);
      const membership = await membershipFor(command.tenantId, identity.uid);
      assertProjectAccess(membership, command.input.projectId);
      const firestore = getFirestore();
      const executionId = stableId(
        "booking",
        command.tenantId,
        command.idempotencyKey,
      );
      const executionReference = firestore.doc(
        `commandExecutions/${executionId}`,
      );
      const prior = await executionReference.get();
      if (prior.exists) {
        response.status(200).json(prior.get("result"));
        return;
      }
      const timestamp = new Date().toISOString();
      const mockMode = process.env.PROVIDER_MOCK_MODE === "true";
      let result: Record<string, unknown>;

      if (command.type === "completeConsultation") {
        const consultationReference = firestore.doc(
          `consultations/${command.input.consultationId}`,
        );
        const projectReference = firestore.doc(
          `projects/${command.input.projectId}`,
        );
        const aiJobReference = firestore.doc(
          `aiJobs/consultation_${command.input.consultationId}`,
        );
        const receiptReference = firestore.doc(
          `actionReceipts/consultation_${command.input.consultationId}`,
        );
        result = await firestore.runTransaction(async (transaction) => {
          const [consultation, project, existingJob] = await Promise.all([
            transaction.get(consultationReference),
            transaction.get(projectReference),
            transaction.get(aiJobReference),
          ]);
          if (
            !consultation.exists ||
            consultation.get("tenantId") !== command.tenantId ||
            consultation.get("projectId") !== command.input.projectId
          )
            throw new Error("CONSULTATION_NOT_FOUND");
          if (
            !project.exists ||
            project.get("tenantId") !== command.tenantId ||
            project.get("state") !== "CONSULTATION"
          )
            throw new Error("PROJECT_NOT_IN_CONSULTATION");
          if (
            !["scheduled", "completed"].includes(
              String(consultation.get("status")),
            )
          )
            throw new Error("CONSULTATION_NOT_COMPLETABLE");
          if (!existingJob.exists)
            await consumeAiQuota(
              transaction,
              firestore,
              command.tenantId,
              timestamp,
            );
          transaction.update(consultationReference, {
            status: "completed",
            internalNotes: command.input.notes,
            completedAt: consultation.get("completedAt") ?? timestamp,
            aiReview: {
              status: "queued",
              humanReviewRequired: true,
            },
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          transaction.update(projectReference, {
            nextAction: "Review consultation brief and package recommendation",
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          if (!existingJob.exists) {
            transaction.create(aiJobReference, {
              id: aiJobReference.id,
              tenantId: command.tenantId,
              projectId: command.input.projectId,
              consultationId: command.input.consultationId,
              type: "consultation_analysis",
              status: "queued",
              attempts: 0,
              humanReviewRequired: true,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }
          transaction.set(receiptReference, {
            id: receiptReference.id,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            title: "Consultation notes saved",
            summary:
              "StudioCue queued a grounded consultation brief, package recommendation, and proposal draft. Nothing was sent to the client.",
            status: "completed",
            source: "booking_autopilot",
            affectedEntityType: "consultation",
            affectedEntityId: command.input.consultationId,
            providerEvidence: null,
            reversible: true,
            retryable: false,
            canCancel: false,
            canRetry: false,
            attempts: 1,
            completedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          },{merge:true});
          return {
            consultationId: command.input.consultationId,
            status: "completed",
            analysisStatus: existingJob.exists ? "already_queued" : "queued",
          };
        });
      } else if (command.type === "scheduleConsultation") {
        const start = new Date(command.input.startsAt);
        const end = new Date(command.input.endsAt);
        if (!Number.isFinite(start.valueOf()) || end <= start)
          throw new Error("INVALID_TIME_RANGE");
        const consultationId = stableId(
          "consultation",
          command.tenantId,
          command.idempotencyKey,
        );
        const meetingId =
          command.input.mode === "zoom"
            ? `zoom_${command.idempotencyKey}`
            : null;
        const joinUrl =
          meetingId && mockMode
            ? `https://zoom.example.test/j/${meetingId}`
            : null;
        const calendarEventId = `gcal_${command.idempotencyKey}`;
        await firestore.doc(`consultations/${consultationId}`).create({
          id: consultationId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          contactId: command.input.contactId,
          mode: command.input.mode,
          status: mockMode ? "scheduled" : "scheduled",
          startsAt: command.input.startsAt,
          endsAt: command.input.endsAt,
          timezone: command.input.timezone,
          location: joinUrl ?? command.input.location,
          calendarEventId,
          calendarHtmlLink: mockMode
            ? `https://calendar.example.test/${calendarEventId}`
            : null,
          meetingId,
          joinUrl,
          providerState: mockMode ? "completed_mock" : "queued",
          internalNotes: null,
          reminderJobIds: [],
          supersedesId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        if (!mockMode) {
          await firestore
            .doc(`providerJobs/consultation_${consultationId}`)
            .create({
              tenantId: command.tenantId,
              projectId: command.input.projectId,
              type: "create_consultation_resources",
              idempotencyKey: command.idempotencyKey,
              status: "queued",
              createdAt: timestamp,
            });
        }
        result = {
          consultationId,
          providerState: mockMode ? "completed_mock" : "queued",
        };
      } else if (command.type === "createEnvelope") {
        const [project, proposal, existingContracts] = await Promise.all([
          firestore.doc(`projects/${command.input.projectId}`).get(),
          firestore.doc(`proposals/${command.input.proposalId}`).get(),
          firestore
            .collection("contracts")
            .where("tenantId", "==", command.tenantId)
            .where("projectId", "==", command.input.projectId)
            .where("proposalId", "==", command.input.proposalId)
            .limit(1)
            .get(),
        ]);
        if (
          !project.exists ||
          project.get("tenantId") !== command.tenantId ||
          project.get("state") !== "CONTRACT_PENDING"
        ) {
          throw new Error("CONTRACT_NOT_READY");
        }
        if (
          !proposal.exists ||
          proposal.get("tenantId") !== command.tenantId ||
          proposal.get("projectId") !== command.input.projectId ||
          proposal.get("status") !== "accepted"
        ) {
          throw new Error("ACCEPTED_PROPOSAL_REQUIRED");
        }
        if (!existingContracts.empty) {
          throw new Error("CONTRACT_ALREADY_EXISTS");
        }
        const contractId = stableId(
          "contract",
          command.tenantId,
          command.idempotencyKey,
        );
        const envelopeId = `envelope_${command.idempotencyKey}`;
        const batch = firestore.batch();
        batch.create(firestore.doc(`contracts/${contractId}`), {
          id: contractId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          proposalId: command.input.proposalId,
          status: "sent",
          provider: "docusign",
          providerEnvelopeId: envelopeId,
          templateId: command.input.templateId,
          signers: command.input.signers.map((signer) => ({
            ...signer,
            status: "sent",
          })),
          sentAt: timestamp,
          completedAt: null,
          signedDocumentId: null,
          certificateDocumentId: null,
          completionEvidence: null,
          fileHash: null,
          lastProviderEventId: null,
          providerState: mockMode ? "completed_mock" : "queued",
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        if (!mockMode)
          batch.create(firestore.doc(`providerJobs/contract_${contractId}`), {
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            type: "create_docusign_envelope",
            contractId,
            idempotencyKey: command.idempotencyKey,
            status: "queued",
            attempts: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        await batch.commit();
        result = {
          contractId,
          envelopeId,
          providerState: mockMode ? "completed_mock" : "queued",
        };
      } else if (command.type === "createRetainerInvoice") {
        const [project, packageSnapshot, existingInvoices] = await Promise.all([
          firestore.doc(`projects/${command.input.projectId}`).get(),
          firestore
            .doc(`packageSnapshots/${command.input.packageSnapshotId}`)
            .get(),
          firestore
            .collection("invoiceReferences")
            .where("tenantId", "==", command.tenantId)
            .where("projectId", "==", command.input.projectId)
            .where("kind", "==", "retainer")
            .limit(1)
            .get(),
        ]);
        if (
          !project.exists ||
          project.get("tenantId") !== command.tenantId ||
          project.get("state") !== "RETAINER_PENDING" ||
          project.get("packageSnapshotId") !==
            command.input.packageSnapshotId
        ) {
          throw new Error("RETAINER_NOT_READY");
        }
        if (
          !packageSnapshot.exists ||
          packageSnapshot.get("tenantId") !== command.tenantId
        )
          throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND");
        if (!existingInvoices.empty) {
          throw new Error("RETAINER_INVOICE_ALREADY_EXISTS");
        }
        const invoiceId = stableId(
          "invoice",
          command.tenantId,
          command.idempotencyKey,
        );
        const providerInvoiceId = `qbo_invoice_${command.idempotencyKey}`;
        const batch = firestore.batch();
        batch.create(firestore.doc(`invoiceReferences/${invoiceId}`), {
          id: invoiceId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          kind: "retainer",
          provider: "quickbooks",
          providerInvoiceId,
          providerCustomerId:
            command.input.customerId ?? `pending_${command.input.projectId}`,
          status: "sent",
          currency: packageSnapshot.get("currency"),
          amountCents: packageSnapshot.get("retainerCents"),
          balanceCents: packageSnapshot.get("retainerCents"),
          dueDate: command.input.dueDate,
          hostedUrl: mockMode
            ? `https://pay.example.test/${providerInvoiceId}`
            : null,
          lastSyncedAt: timestamp,
          lastProviderEventId: null,
          providerState: mockMode ? "completed_mock" : "queued",
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        if (!mockMode)
          batch.create(firestore.doc(`providerJobs/invoice_${invoiceId}`), {
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            type: "create_quickbooks_invoice",
            invoiceId,
            idempotencyKey: command.idempotencyKey,
            status: "queued",
            attempts: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        await batch.commit();
        result = {
          invoiceId,
          providerInvoiceId,
          providerState: mockMode ? "completed_mock" : "queued",
        };
      } else {
        const projectBeforeGate = await firestore
          .doc(`projects/${command.input.projectId}`)
          .get();
        if (
          !projectBeforeGate.exists ||
          projectBeforeGate.get("tenantId") !== command.tenantId
        ) {
          throw new Error("PROJECT_NOT_FOUND");
        }
        const eventDate = String(projectBeforeGate.get("eventDate") ?? "");
        const contactIds = Array.isArray(
          projectBeforeGate.get("clientContactIds"),
        )
          ? (projectBeforeGate.get("clientContactIds") as unknown[]).filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        const [sameDateProjects, contacts, approvedException] =
          await Promise.all([
            firestore
              .collection("projects")
              .where("tenantId", "==", command.tenantId)
              .where("eventDate", "==", eventDate)
              .get(),
            Promise.all(
              contactIds.map((contactId) =>
                firestore.doc(`contacts/${contactId}`).get(),
              ),
            ),
            command.input.approvedRetainerExceptionId
              ? firestore
                  .doc(
                    `bookingExceptions/${command.input.approvedRetainerExceptionId}`,
                  )
                  .get()
              : Promise.resolve(null),
          ]);
        const blockingStates = new Set([
          "BOOKED",
          "PLANNING",
          "READY",
          "EVENT_COMPLETE",
        ]);
        const eventDateAvailable = !sameDateProjects.docs.some(
          (candidate) =>
            candidate.id !== command.input.projectId &&
            blockingStates.has(String(candidate.get("state"))),
        );
        const requiredContactsComplete =
          contactIds.length > 0 &&
          contacts.every(
            (contact) =>
              contact.exists &&
              contact.get("tenantId") === command.tenantId &&
              typeof contact.get("email") === "string" &&
              String(contact.get("email")).includes("@") &&
              typeof contact.get("displayName") === "string" &&
              String(contact.get("displayName")).trim().length > 0,
          );
        const exceptionApproved = Boolean(
          approvedException?.exists &&
            approvedException.get("tenantId") === command.tenantId &&
            approvedException.get("projectId") === command.input.projectId &&
            approvedException.get("type") === "retainer" &&
            approvedException.get("status") === "approved",
        );
        result = await firestore.runTransaction(async (transaction) => {
          const projectReference = firestore.doc(
            `projects/${command.input.projectId}`,
          );
          const [project, contracts, invoices] = await Promise.all([
            transaction.get(projectReference),
            firestore
              .collection("contracts")
              .where("tenantId", "==", command.tenantId)
              .where("projectId", "==", command.input.projectId)
              .where("status", "==", "completed")
              .limit(1)
              .get(),
            firestore
              .collection("invoiceReferences")
              .where("tenantId", "==", command.tenantId)
              .where("projectId", "==", command.input.projectId)
              .where("kind", "==", "retainer")
              .limit(5)
              .get(),
          ]);
          if (!project.exists || project.get("tenantId") !== command.tenantId)
            throw new Error("PROJECT_NOT_FOUND");
          if (
            project.get("stateVersion") !== command.input.expectedProjectVersion
          )
            throw new Error("PROJECT_VERSION_CONFLICT");
          const invoiceCreated = !invoices.empty;
          const retainerPaid = invoices.docs.some(
            (invoice) =>
              invoice.get("status") === "paid" &&
              invoice.get("balanceCents") === 0,
          );
          const checks = {
            contractCompleted: !contracts.empty,
            retainerInvoiceCreated: invoiceCreated,
            retainerSatisfied: retainerPaid || exceptionApproved,
            eventDateAvailable,
            requiredContactsComplete,
          };
          const blockers = Object.entries(checks)
            .filter(([, passed]) => !passed)
            .map(([key]) => key);
          const gateId = stableId(
            "gate",
            command.tenantId,
            command.idempotencyKey,
          );
          transaction.create(firestore.doc(`bookingGateRuns/${gateId}`), {
            id: gateId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            checks,
            blockers,
            passed: blockers.length === 0,
            rulesVersion: 1,
            createdAt: timestamp,
            createdBy: identity.uid,
          });
          if (blockers.length === 0) {
            if (project.get("state") !== "RETAINER_PENDING")
              throw new Error("INVALID_BOOKING_STATE");
            const priorStateVersion = Number(project.get("stateVersion"));
            transaction.update(projectReference, {
              state: "BOOKED",
              stateVersion: priorStateVersion + 1,
              bookingCompletedAt: timestamp,
              clientPortalActive: true,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            const auditId = stableId(
              "audit_booking",
              command.tenantId,
              command.idempotencyKey,
            );
            transaction.create(firestore.doc(`auditEvents/${auditId}`), {
              id: auditId,
              tenantId: command.tenantId,
              projectId: command.input.projectId,
              actorId: identity.uid,
              actorType: "user",
              action: "project.booked",
              entityType: "project",
              entityId: command.input.projectId,
              timestamp,
              before: {
                state: "RETAINER_PENDING",
                stateVersion: priorStateVersion,
              },
              after: {
                state: "BOOKED",
                stateVersion: priorStateVersion + 1,
                bookingGateId: gateId,
              },
              ipAddress: null,
              userAgent: request.header("user-agent") ?? null,
              correlationId:
                request.header("x-correlation-id") ?? command.idempotencyKey,
              automationRunId: null,
              providerEventId: null,
            });
            transaction.create(
              firestore.doc(`providerJobs/booking_${command.input.projectId}`),
              {
                tenantId: command.tenantId,
                projectId: command.input.projectId,
                type: "complete_booking_side_effects",
                idempotencyKey: command.idempotencyKey,
                status: "queued",
                steps: [
                  "dropbox_folders",
                  "production_calendar",
                  "workflow",
                  "checkpoints",
                  "confirmation",
                ],
                createdAt: timestamp,
              },
            );
          }
          return {
            bookingGateId: gateId,
            passed: blockers.length === 0,
            blockers,
          };
        });
      }

      await executionReference.create({
        tenantId: command.tenantId,
        userId: identity.uid,
        commandType: command.type,
        idempotencyKey: command.idempotencyKey,
        result,
        createdAt: timestamp,
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "BOOKING_COMMAND_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
