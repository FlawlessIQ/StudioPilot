import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { consumeAiQuota } from "../saas/usage.js";
import {
  requireProviderForTenant,
  resolveProviderForTenant,
} from "../integrations/capability-resolution.js";
import { productEvent } from "../operations/product-events.js";
import { availabilityWindowSchema } from "./availability.js";
import { bookingGateRequirements } from "./gate-requirements.js";

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
    type: z.literal("cancelConsultation"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      consultationId: z.string().min(1),
      reason: z.string().trim().max(500).nullable(),
    }),
  }),
  z.object({
    type: z.literal("rescheduleConsultation"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      consultationId: z.string().min(1),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      timezone: z.string().min(1),
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
      activateBookingAutomation: z.boolean().default(false),
      retainerDueDays: z.number().int().min(1).max(30).default(7),
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
    /**
     * A signature that happened outside StudioCue, recorded by the studio.
     *
     * Signing providers charge for API access. Without one connected, a
     * project could not leave CONTRACT_PENDING by any route: createEnvelope
     * refuses, the journey withholds its manual advance for
     * evidence-controlled steps, and the generic state command throws
     * EVIDENCE_CONTROLLED_TRANSITION. Only a provider webhook ever wrote the
     * next state, so a studio that signs by email was stuck at the proposal
     * for good.
     *
     * This is the signature equivalent of the retainer exception the gate
     * already accepts: a named human takes responsibility, and the record
     * says so rather than implying a provider verified anything.
     */
    type: z.literal("recordSignedAgreement"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      proposalId: z.string().min(1),
      /** Who signed, as the studio would name them to the couple. */
      signerName: z.string().min(1).max(160),
      signedAt: z.string().date(),
      /** A stored document holding the signed agreement, when there is one. */
      signedDocumentId: z.string().min(1).max(200).nullable().default(null),
      /** How it was signed, in the studio's words. */
      method: z.string().min(1).max(200),
      // Deliberately not defaulted: recording a signature has to be an
      // explicit act, not something a client library can omit its way into.
      attestation: z.literal(true),
    }),
  }),
  z.object({
    /**
     * The retainer arrived outside StudioCue and the studio says so.
     *
     * The mirror of recordSignedAgreement, for the same dead end one step
     * later. With no invoicing provider connected, createRetainerInvoice
     * refuses rather than raise an invoice against an account nobody
     * connected — correct, but it left the booking gate permanently short
     * of both a created retainer and a paid one, so a studio taking bank
     * transfers could not confirm a booking at all.
     *
     * Not the same as the retainer exception the gate already accepts.
     * That one says the money has not arrived and the studio is going
     * ahead anyway; this says the money is in and StudioCue was not the
     * one to collect it. The two stay separate fields all the way to the
     * audit record.
     */
    type: z.literal("recordRetainerPayment"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      packageSnapshotId: z.string().min(1),
      paidAt: z.string().date(),
      /** How the money arrived, in the studio's words. */
      method: z.string().min(1).max(200),
      /** A bank reference or cheque number, when there is one. */
      reference: z.string().max(200).nullable().default(null),
      // The amount is never taken from the client. It is read from the
      // package snapshot the couple accepted, so "the retainer was paid"
      // cannot quietly mean a different number than the one quoted.
      attestation: z.literal(true),
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
  z.object({
    type: z.literal("setConsultationSettings"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z
      .object({
        durationMinutes: z.number().int().min(15).max(120),
        bufferMinutes: z.number().int().min(0).max(60),
        mode: z.enum(["closed_default", "open_default"]).default("closed_default"),
        windows: z.array(availabilityWindowSchema).max(21),
        unavailableWindows: z.array(availabilityWindowSchema).max(50).default([]),
        blockedDates: z.array(z.string().date()).max(200),
      })
      .refine(
        (settings) => settings.mode !== "open_default" || settings.windows.length > 0,
        { message: "open_default mode needs at least one envelope window", path: ["windows"] },
      ),
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
      // setConsultationSettings is tenant-wide (studio business hours, not
      // scoped to a project) — it does the owner/admin check itself below.
      if ("projectId" in command.input) {
        assertProjectAccess(membership, command.input.projectId);
      }
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
        // These placeholders are mock-mode fixtures and must not be written in
        // live mode. The provider worker creates the real resources only when
        // the field is still empty — `if (mode === "zoom" && !meetingId)` and
        // `else if (!calendarEventId)` in operations/provider-runtime.ts — so a
        // fabricated id here silently suppresses the very call it stands in for.
        // Live consultations were being written with providerState "queued" and
        // a `gcal_<uuid>` / `zoom_<uuid>` id, the worker then skipped both
        // creates and marked the job succeeded, and the result was a booking
        // with no Google Calendar event, no Zoom meeting, and a null joinUrl —
        // so the client had nothing to join. The fields beside them
        // (joinUrl, calendarHtmlLink, providerState) were already mock-guarded;
        // these two were not.
        const meetingId =
          command.input.mode === "zoom" && mockMode
            ? `zoom_${command.idempotencyKey}`
            : null;
        const joinUrl = meetingId
          ? `https://zoom.example.test/j/${meetingId}`
          : null;
        const calendarEventId = mockMode
          ? `gcal_${command.idempotencyKey}`
          : null;
        await firestore.doc(`consultations/${consultationId}`).create({
          id: consultationId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          contactId: command.input.contactId,
          mode: command.input.mode,
          status: "scheduled",
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
      } else if (command.type === "cancelConsultation") {
        const consultationReference = firestore.doc(
          `consultations/${command.input.consultationId}`,
        );
        result = await firestore.runTransaction(async (transaction) => {
          const consultation = await transaction.get(consultationReference);
          if (
            !consultation.exists ||
            consultation.get("tenantId") !== command.tenantId ||
            consultation.get("projectId") !== command.input.projectId
          )
            throw new Error("CONSULTATION_NOT_FOUND");
          const status = String(consultation.get("status"));
          // Cancelling an already-cancelled consultation is a no-op rather than
          // an error, so a retried click cannot fail after the first succeeded.
          if (status === "cancelled")
            return { consultationId: command.input.consultationId, status };
          if (status !== "scheduled")
            throw new Error("CONSULTATION_NOT_CANCELLABLE");
          transaction.update(consultationReference, {
            status: "cancelled",
            cancelledAt: timestamp,
            cancellationReason: command.input.reason,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          return { consultationId: command.input.consultationId, status: "cancelled" };
        });
        // The external resources are removed by the worker, not here: deleting a
        // Google event and a Zoom meeting are non-transactional side effects and
        // must not run inside the Firestore transaction above. calendarEventId
        // and meetingId are deliberately left on the record so the worker knows
        // what to remove and so the history survives cancellation.
        if (!mockMode && (result as { status?: string }).status === "cancelled") {
          await firestore
            .doc(`providerJobs/consultation_cancel_${command.input.consultationId}`)
            .set(
              {
                tenantId: command.tenantId,
                projectId: command.input.projectId,
                consultationId: command.input.consultationId,
                type: "cancel_consultation_resources",
                idempotencyKey: command.idempotencyKey,
                status: "queued",
                createdAt: timestamp,
              },
              { merge: true },
            );
        }
      } else if (command.type === "rescheduleConsultation") {
        const start = new Date(command.input.startsAt);
        const end = new Date(command.input.endsAt);
        if (!Number.isFinite(start.valueOf()) || end <= start)
          throw new Error("INVALID_TIME_RANGE");
        const consultationReference = firestore.doc(
          `consultations/${command.input.consultationId}`,
        );
        result = await firestore.runTransaction(async (transaction) => {
          const consultation = await transaction.get(consultationReference);
          if (
            !consultation.exists ||
            consultation.get("tenantId") !== command.tenantId ||
            consultation.get("projectId") !== command.input.projectId
          )
            throw new Error("CONSULTATION_NOT_FOUND");
          if (String(consultation.get("status")) !== "scheduled")
            throw new Error("CONSULTATION_NOT_RESCHEDULABLE");
          // The consultation moves in place and keeps its id, so the calendar
          // event id — sha256("consultation:<id>") — stays stable and the
          // client's existing invitation updates instead of being replaced by a
          // second event. supersedesId stays reserved for a future "rebook as a
          // new consultation" flow, which is a different intent.
          transaction.update(consultationReference, {
            startsAt: command.input.startsAt,
            endsAt: command.input.endsAt,
            timezone: command.input.timezone,
            rescheduledAt: timestamp,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          return {
            consultationId: command.input.consultationId,
            startsAt: command.input.startsAt,
            endsAt: command.input.endsAt,
          };
        });
        if (!mockMode) {
          await firestore
            .doc(
              `providerJobs/${stableId("consultresched", command.tenantId, command.idempotencyKey)}`,
            )
            .create({
              tenantId: command.tenantId,
              projectId: command.input.projectId,
              consultationId: command.input.consultationId,
              type: "reschedule_consultation_resources",
              idempotencyKey: command.idempotencyKey,
              status: "queued",
              createdAt: timestamp,
            });
        }
      } else if (command.type === "createEnvelope") {
        const batchSupersede: FirebaseFirestore.DocumentReference[] = [];
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
        // A contract the provider refused is not a contract in flight. It
        // used to block every further attempt with CONTRACT_ALREADY_EXISTS,
        // and the workspace hides the send form once any contract exists —
        // so a Dropbox Sign 402 left the booking with no way forward at all,
        // in the UI or through the command.
        const liveContracts = existingContracts.docs.filter(
          (document) => document.get("status") !== "failed",
        );
        if (liveContracts.length) {
          throw new Error("CONTRACT_ALREADY_EXISTS");
        }
        // Keep the failed attempt as history rather than deleting it: it is
        // the record of what the provider said, and the next query must not
        // match it again.
        for (const stale of existingContracts.docs) {
          batchSupersede.push(stale.ref);
        }
        // Outside mock mode this queues a real signature request, so an
        // unresolved capability must refuse rather than guess DocuSign and
        // fail minutes later inside a provider job. In mock mode nothing is
        // dispatched and the provider name is only recorded, so the old
        // fallback is still the right behaviour there.
        const signingProvider = mockMode
          ? await resolveProviderForTenant(
              firestore,
              command.tenantId,
              "signing",
              "docusign",
            )
          : await requireProviderForTenant(
              firestore,
              command.tenantId,
              "signing",
            );
        const contractId = stableId(
          "contract",
          command.tenantId,
          command.idempotencyKey,
        );
        const envelopeId = `envelope_${command.idempotencyKey}`;
        const batch = firestore.batch();
        for (const stale of batchSupersede) {
          batch.update(stale, {
            status: "superseded",
            supersededAt: timestamp,
            supersededBy: contractId,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
        }
        batch.create(firestore.doc(`contracts/${contractId}`), {
          id: contractId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          proposalId: command.input.proposalId,
          // "Sent" is the provider's word, not ours. This used to be stamped
          // here, before the request had been made, so a contract Dropbox
          // Sign refused with a 402 still read "Sent" with a sentAt time and
          // the journey showed the booking advancing. createDropboxSignRequest
          // sets both once the provider accepts; a dead-lettered job marks
          // this failed.
          status: mockMode ? "sent" : "queued",
          provider: signingProvider,
          providerEnvelopeId: envelopeId,
          templateId: command.input.templateId,
          signers: command.input.signers.map((signer) => ({
            ...signer,
            status: mockMode ? "sent" : "queued",
          })),
          sentAt: mockMode ? timestamp : null,
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
            type: signingProvider === "dropbox_sign"
              ? "create_dropbox_sign_request"
              : "create_docusign_envelope",
            contractId,
            idempotencyKey: command.idempotencyKey,
            status: "queued",
            attempts: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        // Sending the agreement fulfills the "Prepare client agreement" task
        // the portal creates on acceptance; left open it keeps demanding the
        // contract long after it is signed.
        const decisionTask = await firestore
          .doc(`tasks/proposal_decision_${command.input.proposalId}`)
          .get();
        if (
          decisionTask.exists &&
          decisionTask.get("tenantId") === command.tenantId &&
          decisionTask.get("status") !== "completed"
        ) {
          batch.update(decisionTask.ref, {
            status: "completed",
            completedAt: timestamp,
            completedBy: identity.uid,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
        }
        if (command.input.activateBookingAutomation) {
          batch.set(
            firestore.doc(`bookingOrchestrations/${command.input.projectId}`),
            {
              id: command.input.projectId,
              tenantId: command.tenantId,
              projectId: command.input.projectId,
              proposalId: command.input.proposalId,
              contractId,
              invoiceId: null,
              status: "active",
              currentStep: "wait_for_signature",
              policy: {
                createRetainerAfterSignature: true,
                completeBookingAfterPayment: true,
                retainerDueDays: command.input.retainerDueDays,
              },
              approvedBy: identity.uid,
              approvedAt: timestamp,
              lastError: null,
              completedAt: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            { merge: false },
          );
          const approvedEvent = productEvent({
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            actorId: identity.uid,
            name: "booking.sequence_approved",
            occurredAt: timestamp,
            correlationId: command.idempotencyKey,
            sourceEntityType: "bookingOrchestration",
            sourceEntityId: command.input.projectId,
            properties: {
              proposalId: command.input.proposalId,
              contractId,
              retainerDueDays: command.input.retainerDueDays,
            },
          });
          batch.create(
            firestore.doc(`productEvents/${approvedEvent.id}`),
            approvedEvent,
          );
        }
        await batch.commit();
        result = {
          contractId,
          envelopeId,
          providerState: mockMode ? "completed_mock" : "queued",
        };
      } else if (command.type === "recordSignedAgreement") {
        if (
          !["studio_owner", "studio_admin"].includes(String(membership.role))
        ) {
          throw new Error("SIGNATURE_ATTESTATION_PERMISSION_REQUIRED");
        }
        const [project, proposal, existingContracts] = await Promise.all([
          firestore.doc(`projects/${command.input.projectId}`).get(),
          firestore.doc(`proposals/${command.input.proposalId}`).get(),
          firestore
            .collection("contracts")
            .where("tenantId", "==", command.tenantId)
            .where("projectId", "==", command.input.projectId)
            .where("status", "==", "completed")
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
          throw new Error("CONTRACT_ALREADY_COMPLETED");
        }

        const contractId = stableId(
          "contract",
          command.tenantId,
          command.idempotencyKey,
        );
        const priorStateVersion = Number(project.get("stateVersion") ?? 0);
        // An approved booking sequence waits for a signature on one named
        // contract. Attesting creates a different contract, so without this
        // the orchestrator sits on `wait_for_signature` against a contract
        // that will never complete — the retainer is never raised and the
        // workspace shows "Waiting for verified signature" forever.
        //
        // The signature the studio just recorded is this booking's
        // signature, so the plan should be watching this contract.
        const orchestrationReference = firestore.doc(
          `bookingOrchestrations/${command.input.projectId}`,
        );
        const orchestration = await orchestrationReference.get();
        const orchestrationActive =
          orchestration.exists && orchestration.get("status") === "active";
        const batch = firestore.batch();
        if (orchestrationActive) {
          batch.update(orchestrationReference, {
            contractId,
            updatedAt: timestamp,
          });
        }
        batch.create(firestore.doc(`contracts/${contractId}`), {
          id: contractId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          proposalId: command.input.proposalId,
          status: "completed",
          // Never a provider name. Everything downstream reads this to
          // decide whether a provider verified the signature or a person
          // vouched for it, and the two must stay tellable apart.
          provider: null,
          completionAuthority: "manual_attested",
          providerEnvelopeId: null,
          templateId: null,
          signers: [
            {
              name: command.input.signerName,
              email: null,
              role: "Client",
              order: 1,
              status: "completed",
            },
          ],
          sentAt: null,
          completedAt: `${command.input.signedAt}T00:00:00.000Z`,
          signedDocumentId: command.input.signedDocumentId,
          certificateDocumentId: null,
          completionEvidence: {
            kind: "manual_attestation",
            method: command.input.method,
            signerName: command.input.signerName,
            signedAt: command.input.signedAt,
            attestedBy: identity.uid,
            attestedAt: timestamp,
          },
          fileHash: null,
          lastProviderEventId: null,
          providerState: "not_applicable",
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        batch.update(firestore.doc(`projects/${command.input.projectId}`), {
          state: "RETAINER_PENDING",
          stateVersion: priorStateVersion + 1,
          updatedAt: timestamp,
          updatedBy: identity.uid,
        });
        const auditId = stableId(
          "audit_attested",
          command.tenantId,
          command.idempotencyKey,
        );
        batch.create(firestore.doc(`auditEvents/${auditId}`), {
          id: auditId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          actorId: identity.uid,
          // A person, not a provider. The webhook path writes "provider"
          // here and the difference is the whole point of this record.
          actorType: "user",
          action: "contract.signature_attested",
          entityType: "contract",
          entityId: contractId,
          timestamp,
          before: {
            projectState: "CONTRACT_PENDING",
            stateVersion: priorStateVersion,
          },
          after: {
            projectState: "RETAINER_PENDING",
            stateVersion: priorStateVersion + 1,
            signerName: command.input.signerName,
            signedAt: command.input.signedAt,
            method: command.input.method,
            signedDocumentId: command.input.signedDocumentId,
          },
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: command.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        await batch.commit();
        result = { contractId, completionAuthority: "manual_attested" };
      } else if (command.type === "recordRetainerPayment") {
        if (
          !["studio_owner", "studio_admin"].includes(String(membership.role))
        ) {
          throw new Error("RETAINER_ATTESTATION_PERMISSION_REQUIRED");
        }
        const [project, packageSnapshot, contracts, existingInvoices] =
          await Promise.all([
            firestore.doc(`projects/${command.input.projectId}`).get(),
            firestore
              .doc(`packageSnapshots/${command.input.packageSnapshotId}`)
              .get(),
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
              .limit(1)
              .get(),
          ]);
        if (
          !project.exists ||
          project.get("tenantId") !== command.tenantId ||
          project.get("state") !== "RETAINER_PENDING" ||
          project.get("packageSnapshotId") !== command.input.packageSnapshotId
        ) {
          throw new Error("RETAINER_NOT_READY");
        }
        if (
          !packageSnapshot.exists ||
          packageSnapshot.get("tenantId") !== command.tenantId
        ) {
          throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND");
        }
        // The signature is the step before this one, and the gate requires
        // both. Recording money against a project whose agreement is not
        // signed would produce a booking with paid evidence and no
        // contract, which is the wrong order to be permissive in.
        if (contracts.empty) {
          throw new Error("SIGNED_CONTRACT_REQUIRED");
        }
        if (!existingInvoices.empty) {
          throw new Error("RETAINER_INVOICE_ALREADY_EXISTS");
        }
        const invoiceId = stableId(
          "invoice_attested",
          command.tenantId,
          command.idempotencyKey,
        );
        // The amount the couple accepted, not one the browser sent.
        const amountCents = Number(packageSnapshot.get("retainerCents") ?? 0);
        if (!Number.isInteger(amountCents) || amountCents <= 0) {
          throw new Error("RETAINER_AMOUNT_NOT_FOUND");
        }
        const paidAtTimestamp = `${command.input.paidAt}T00:00:00.000Z`;
        const orchestrationReference = firestore.doc(
          `bookingOrchestrations/${command.input.projectId}`,
        );
        const orchestration = await orchestrationReference.get();
        const batch = firestore.batch();
        batch.create(firestore.doc(`invoiceReferences/${invoiceId}`), {
          id: invoiceId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          kind: "retainer",
          // Never a provider name, for the same reason the attested
          // contract writes null: everything downstream reads this to tell
          // a payment a provider confirmed from one a person vouched for.
          provider: null,
          completionAuthority: "manual_attested",
          providerInvoiceId: null,
          providerCustomerId: null,
          status: "paid",
          currency: packageSnapshot.get("currency"),
          amountCents,
          balanceCents: 0,
          dueDate: command.input.paidAt,
          hostedUrl: null,
          paidAt: paidAtTimestamp,
          completionEvidence: {
            kind: "manual_attestation",
            method: command.input.method,
            reference: command.input.reference,
            paidAt: command.input.paidAt,
            amountCents,
            attestedBy: identity.uid,
            attestedAt: timestamp,
          },
          lastSyncedAt: null,
          lastProviderEventId: null,
          providerState: "not_applicable",
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        // An active plan is waiting to be told a retainer exists. Left
        // pointing at nothing it would sit on `create_retainer` while the
        // booking was ready to confirm — the same stranding the contract
        // path had.
        if (orchestration.exists && orchestration.get("status") === "active") {
          batch.update(orchestrationReference, {
            invoiceId,
            updatedAt: timestamp,
          });
        }
        const retainerAuditId = stableId(
          "audit_retainer_attested",
          command.tenantId,
          command.idempotencyKey,
        );
        batch.create(firestore.doc(`auditEvents/${retainerAuditId}`), {
          id: retainerAuditId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          actorId: identity.uid,
          // A person, not a provider. The webhook path writes "provider".
          actorType: "user",
          action: "retainer.payment_attested",
          entityType: "invoiceReference",
          entityId: invoiceId,
          timestamp,
          before: { retainerRecorded: false },
          after: {
            retainerRecorded: true,
            amountCents,
            currency: packageSnapshot.get("currency"),
            paidAt: command.input.paidAt,
            method: command.input.method,
            reference: command.input.reference,
          },
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: command.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        await batch.commit();
        result = {
          invoiceId,
          amountCents,
          completionAuthority: "manual_attested",
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
        // Same reasoning as signing above: refuse rather than raise an
        // invoice against a QuickBooks account nobody connected.
        const invoicingProvider = mockMode
          ? await resolveProviderForTenant(
              firestore,
              command.tenantId,
              "invoicing",
              "quickbooks",
            )
          : await requireProviderForTenant(
              firestore,
              command.tenantId,
              "invoicing",
            );
        const invoiceId = stableId(
          "invoice",
          command.tenantId,
          command.idempotencyKey,
        );
        const providerInvoiceId = invoicingProvider === "stripe"
          ? `stripe_invoice_${command.idempotencyKey}`
          : `qbo_invoice_${command.idempotencyKey}`;
        const batch = firestore.batch();
        batch.create(firestore.doc(`invoiceReferences/${invoiceId}`), {
          id: invoiceId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          kind: "retainer",
          provider: invoicingProvider,
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
            type: invoicingProvider === "stripe"
              ? "create_stripe_invoice"
              : "create_quickbooks_invoice",
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
      } else if (command.type === "runBookingGate") {
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
          const attestedManually = contracts.docs.some(
            (contract) =>
              contract.get("completionAuthority") === "manual_attested",
          );
          // A retainer the studio recorded rather than a provider
          // confirmed. Read from the record's own authority, so a payment
          // can never be reported as QuickBooks' when QuickBooks never saw
          // it.
          const retainerAttestedManually = invoices.docs.some(
            (invoice) =>
              invoice.get("completionAuthority") === "manual_attested",
          );
          const checks = {
            contractCompleted: !contracts.empty && !attestedManually,
            contractAttestedManually: attestedManually,
            retainerInvoiceCreated: invoiceCreated && !retainerAttestedManually,
            retainerAttestedManually,
            retainerSatisfied: retainerPaid && !retainerAttestedManually,
            retainerExceptionApproved: exceptionApproved,
            eventDateAvailable,
            requiredContactsComplete,
          };
          // Fold the alternatives before asking what is missing: several
          // evidence fields answer the same requirement by different
          // authorities. See gate-requirements.ts.
          const requirements = bookingGateRequirements(checks);
          const blockers = Object.entries(requirements)
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
            requirements,
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
      } else if (command.type === "setConsultationSettings") {
        if (!["studio_owner", "studio_admin"].includes(String(membership.role))) {
          throw new Error("FORBIDDEN");
        }
        const settingsReference = firestore.doc(
          `consultationSettings/${command.tenantId}`,
        );
        const existing = await settingsReference.get();
        const before = existing.exists ? existing.data() : null;
        await settingsReference.set(
          {
            tenantId: command.tenantId,
            durationMinutes: command.input.durationMinutes,
            bufferMinutes: command.input.bufferMinutes,
            mode: command.input.mode,
            windows: command.input.windows,
            unavailableWindows: command.input.unavailableWindows,
            blockedDates: command.input.blockedDates,
            createdAt: existing.exists ? existing.get("createdAt") : timestamp,
            createdBy: existing.exists ? existing.get("createdBy") : identity.uid,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          },
          { merge: false },
        );
        await firestore.collection("auditEvents").doc().create({
          tenantId: command.tenantId,
          projectId: null,
          actorId: identity.uid,
          actorType: "user",
          action: "consultation.settings_updated",
          entityType: "consultationSettings",
          entityId: command.tenantId,
          timestamp,
          before,
          after: command.input,
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: command.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        result = { tenantId: command.tenantId, ...command.input };
      } else {
        throw new Error("UNKNOWN_COMMAND");
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
