import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

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
      customerId: z.string().min(1),
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
      eventDateAvailable: z.boolean(),
      requiredContactsComplete: z.boolean(),
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

      if (command.type === "scheduleConsultation") {
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
        const packageSnapshot = await firestore
          .doc(`packageSnapshots/${command.input.packageSnapshotId}`)
          .get();
        if (
          !packageSnapshot.exists ||
          packageSnapshot.get("tenantId") !== command.tenantId
        )
          throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND");
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
          providerCustomerId: command.input.customerId,
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
          const exceptionApproved =
            command.input.approvedRetainerExceptionId !== null;
          const checks = {
            contractCompleted: !contracts.empty,
            retainerInvoiceCreated: invoiceCreated,
            retainerSatisfied: retainerPaid || exceptionApproved,
            eventDateAvailable: command.input.eventDateAvailable,
            requiredContactsComplete: command.input.requiredContactsComplete,
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
            transaction.update(projectReference, {
              state: "BOOKED",
              stateVersion: command.input.expectedProjectVersion + 1,
              bookingCompletedAt: timestamp,
              clientPortalActive: true,
              updatedAt: timestamp,
              updatedBy: identity.uid,
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
