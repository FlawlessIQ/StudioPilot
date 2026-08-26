import { expiryOnSend } from "./proposal-expiry.js";
import { createHash } from "node:crypto";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { mintClientInvitation } from "../client/invitation-mint.js";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import {
  assertProposalAction,
  canApproveProposal,
  canCreateProposalForProject,
  canSendProposal,
} from "./proposal-domain.js";

const authoringFields = z.object({
  expiresAt: z.string().datetime(),
  notes: z.string().trim().max(4000).nullable(),
  termsSummary: z.string().trim().min(10).max(6000),
  retainerDueDate: z.string().date().nullable(),
  balanceDueDate: z.string().date().nullable(),
  /**
   * The deposit to ask for on this offer, overriding what the package's
   * rule produced.
   *
   * An imported price list rarely states a retainer, so the package it
   * becomes often carries none — and a photographer setting one client's
   * deposit should not have to go and edit the package first. The locked
   * snapshot is untouched: it stays the record of what was priced, and this
   * only moves the split between the two payments.
   */
  retainerOverrideCents: z.number().int().nonnegative().safe().nullable().optional(),
});

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_draft"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: authoringFields.extend({ projectId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("update_draft"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: authoringFields.extend({
      proposalId: z.string().min(1),
      expectedDraftRevision: z.number().int().positive(),
    }),
  }),
  z.object({
    type: z.enum([
      "submit_for_approval",
      "return_to_draft",
      "approve",
      "regenerate_pdf",
      "send",
      "resend",
    ]),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ proposalId: z.string().min(1) }),
  }),
]);

type Membership = {
  role: string;
  status: string;
  projectIds: string[];
};

type CommandResult = Record<string, unknown>;

const authorRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
]);

function stableId(scope: string, tenantId: string, key: string): string {
  const digest = createHash("sha256")
    .update(`${scope}:${tenantId}:${key}`)
    .digest("hex")
    .slice(0, 32);
  return `${scope}_${digest}`;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function assertFutureExpiration(value: string): void {
  const expiration = new Date(value);
  if (
    !Number.isFinite(expiration.valueOf()) ||
    expiration.valueOf() <= Date.now()
  ) {
    throw new Error("PROPOSAL_EXPIRATION_MUST_BE_FUTURE");
  }
}

async function membershipFor(
  tenantId: string,
  userId: string,
): Promise<Membership> {
  const membership = await getFirestore()
    .doc(`memberships/${tenantId}_${userId}`)
    .get();
  const role = String(membership.get("role") ?? "");
  if (
    !membership.exists ||
    membership.get("status") !== "active" ||
    !authorRoles.has(role)
  ) {
    throw new Error("FORBIDDEN");
  }
  return {
    role,
    status: "active",
    projectIds: stringList(membership.get("projectIds")),
  };
}

function assertProjectAccess(
  membership: Membership,
  projectId: string,
): void {
  if (
    membership.role === "studio_owner" ||
    membership.role === "studio_admin"
  ) {
    return;
  }
  if (!membership.projectIds.includes(projectId)) {
    throw new Error("FORBIDDEN");
  }
}

function audit(
  transaction: Transaction,
  input: {
    id: string;
    tenantId: string;
    projectId: string;
    actorId: string;
    action: string;
    proposalId: string;
    timestamp: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
    userAgent: string | null;
    correlationId: string;
  },
): void {
  transaction.create(getFirestore().doc(`auditEvents/${input.id}`), {
    id: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    actorId: input.actorId,
    actorType: "user",
    action: input.action,
    entityType: "proposal",
    entityId: input.proposalId,
    timestamp: input.timestamp,
    before: input.before,
    after: input.after,
    ipAddress: null,
    userAgent: input.userAgent,
    correlationId: input.correlationId,
    automationRunId: null,
    providerEventId: null,
  });
}

function paymentSchedule(
  packageData: Record<string, unknown>,
  retainerDueDate: string | null,
  balanceDueDate: string | null,
  retainerOverrideCents?: number | null,
) {
  const totalCents = numberValue(packageData.totalCents);
  // Never more than the total: a deposit larger than the price would make
  // the final balance negative.
  const retainerCents =
    typeof retainerOverrideCents === "number"
      ? Math.min(retainerOverrideCents, totalCents)
      : numberValue(packageData.retainerCents);
  return [
    {
      label: "Retainer",
      amountCents: retainerCents,
      dueDate: retainerDueDate,
    },
    {
      label: "Final balance",
      amountCents: Math.max(0, totalCents - retainerCents),
      dueDate: balanceDueDate,
    },
  ];
}

function lineItems(packageData: Record<string, unknown>) {
  const basePriceCents = numberValue(packageData.basePriceCents);
  const addOns = Array.isArray(packageData.addOns)
    ? packageData.addOns.map(objectValue)
    : [];
  return [
    {
      description: stringValue(packageData.packageName, "Photography package"),
      quantity: 1,
      unitPriceCents: basePriceCents,
      totalCents: basePriceCents,
    },
    ...addOns.map((item) => ({
      description: stringValue(item.name, "Add-on"),
      quantity: Math.max(1, numberValue(item.quantity)),
      unitPriceCents: numberValue(item.unitPriceCents),
      totalCents: numberValue(item.lineTotalCents),
    })),
  ];
}

export const proposalCommand = onRequest(
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
      const db = getFirestore();
      const executionId = stableId(
        "proposal_command",
        command.tenantId,
        command.idempotencyKey,
      );
      const executionReference = db.doc(`commandExecutions/${executionId}`);
      const timestamp = new Date().toISOString();
      const correlationId = stableId(
        "proposal_correlation",
        command.tenantId,
        command.idempotencyKey,
      );
      const userAgent = request.header("user-agent") ?? null;

      const result = await db.runTransaction<CommandResult>(
        async (transaction) => {
          const priorExecution = await transaction.get(executionReference);
          if (priorExecution.exists) {
            return objectValue(priorExecution.get("result"));
          }

          if (command.type === "create_draft") {
            assertFutureExpiration(command.input.expiresAt);
            const projectReference = db.doc(
              `projects/${command.input.projectId}`,
            );
            const project = await transaction.get(projectReference);
            if (
              !project.exists ||
              project.get("tenantId") !== command.tenantId
            ) {
              throw new Error("PROJECT_NOT_FOUND");
            }
            assertProjectAccess(membership, project.id);
            if (!canCreateProposalForProject(String(project.get("state")))) {
              throw new Error("PROJECT_NOT_READY_FOR_PROPOSAL");
            }
            const packageSnapshotId = stringValue(
              project.get("packageSnapshotId"),
            );
            if (!packageSnapshotId) {
              throw new Error("PACKAGE_SNAPSHOT_REQUIRED");
            }

            const clientIds = stringList(project.get("clientContactIds"));
            const clientId = clientIds[0];
            if (!clientId) throw new Error("CLIENT_CONTACT_REQUIRED");
            const [packageDocument, contact, proposals] = await Promise.all([
              transaction.get(
                db.doc(`packageSnapshots/${packageSnapshotId}`),
              ),
              transaction.get(db.doc(`contacts/${clientId}`)),
              transaction.get(
                db
                  .collection("proposals")
                  .where("tenantId", "==", command.tenantId)
                  .where("projectId", "==", project.id),
              ),
            ]);
            if (
              !packageDocument.exists ||
              packageDocument.get("tenantId") !== command.tenantId ||
              packageDocument.get("projectId") !== project.id
            ) {
              throw new Error("PACKAGE_SNAPSHOT_INVALID");
            }
            if (
              !contact.exists ||
              contact.get("tenantId") !== command.tenantId ||
              typeof contact.get("email") !== "string"
            ) {
              throw new Error("CLIENT_EMAIL_REQUIRED");
            }

            const ordered = [...proposals.docs].sort(
              (left, right) =>
                Number(right.get("version") ?? 0) -
                Number(left.get("version") ?? 0),
            );
            const openDraft = ordered.find((proposal) =>
              ["draft", "internal_review", "approved"].includes(
                String(proposal.get("status")),
              ),
            );
            if (openDraft) {
              throw new Error(`OPEN_PROPOSAL_EXISTS:${openDraft.id}`);
            }
            if (
              ordered.some(
                (proposal) => String(proposal.get("status")) === "accepted",
              )
            ) {
              throw new Error("ACCEPTED_PROPOSAL_IS_FINAL");
            }

            const packageData = objectValue(packageDocument.data());
            const proposalId = stableId(
              "proposal",
              command.tenantId,
              command.idempotencyKey,
            );
            const version =
              Number(ordered[0]?.get("version") ?? 0) + 1;
            const proposalReference = db.doc(`proposals/${proposalId}`);
            const proposal = {
              id: proposalId,
              tenantId: command.tenantId,
              projectId: project.id,
              packageSnapshotId,
              version,
              status: "draft",
              clientSnapshot: {
                displayName: stringValue(
                  contact.get("displayName"),
                  stringValue(contact.get("email")),
                ),
                email: stringValue(contact.get("email")).toLowerCase(),
              },
              eventSnapshot: {
                name: stringValue(project.get("name"), "Photography project"),
                eventType: stringValue(
                  project.get("eventType"),
                  "Photography",
                ),
                eventDate: stringValue(project.get("eventDate")),
                timezone: stringValue(project.get("timezone"), "UTC"),
                venue: project.get("venueName") ?? null,
              },
              pricingSnapshot: {
                currency: stringValue(packageData.currency, "USD"),
                packageName: stringValue(
                  packageData.packageName,
                  "Photography package",
                ),
                subtotalCents: numberValue(packageData.subtotalCents),
                discountCents: numberValue(packageData.discountCents),
                taxCents: numberValue(packageData.taxCents),
                retainerCents: numberValue(packageData.retainerCents),
                totalCents: numberValue(packageData.totalCents),
                lineItems: lineItems(packageData),
              },
              paymentSchedule: paymentSchedule(
                packageData,
                command.input.retainerDueDate,
                command.input.balanceDueDate,
                command.input.retainerOverrideCents,
              ),
              expiresAt: command.input.expiresAt,
              notes: command.input.notes,
              termsSummary: command.input.termsSummary,
              pdfDocumentId: null,
              pdfState: "not_requested",
              draftRevision: 1,
              submittedAt: null,
              approvedAt: null,
              approvedBy: null,
              sentAt: null,
              viewedAt: null,
              acceptedAt: null,
              declinedAt: null,
              declineReason: null,
              decisionBy: null,
              emailJobId: null,
              emailDeliveryStatus: "not_sent",
              emailMessageId: null,
              supersedesId: ordered[0]?.id ?? null,
              createdAt: timestamp,
              updatedAt: timestamp,
              createdBy: identity.uid,
              updatedBy: identity.uid,
              archivedAt: null,
            };
            transaction.create(proposalReference, proposal);
            audit(transaction, {
              id: stableId("audit", command.tenantId, `${executionId}:created`),
              tenantId: command.tenantId,
              projectId: project.id,
              actorId: identity.uid,
              action: "proposal.created",
              proposalId,
              timestamp,
              before: null,
              after: { status: "draft", version, packageSnapshotId },
              userAgent,
              correlationId,
            });
            const output = {
              proposalId,
              projectId: project.id,
              version,
              status: "draft",
            };
            transaction.create(executionReference, {
              tenantId: command.tenantId,
              idempotencyKey: command.idempotencyKey,
              result: output,
              createdAt: timestamp,
            });
            return output;
          }

          const proposalReference = db.doc(
            `proposals/${command.input.proposalId}`,
          );
          const proposal = await transaction.get(proposalReference);
          if (
            !proposal.exists ||
            proposal.get("tenantId") !== command.tenantId
          ) {
            throw new Error("PROPOSAL_NOT_FOUND");
          }
          const projectId = stringValue(proposal.get("projectId"));
          assertProjectAccess(membership, projectId);
          const currentStatus = stringValue(proposal.get("status"));
          assertProposalAction(currentStatus, command.type);
          const before = {
            status: currentStatus,
            draftRevision: numberValue(proposal.get("draftRevision")) || 1,
            pdfDocumentId: proposal.get("pdfDocumentId") ?? null,
          };
          let output: CommandResult;

          if (command.type === "update_draft") {
            assertFutureExpiration(command.input.expiresAt);
            const currentRevision =
              numberValue(proposal.get("draftRevision")) || 1;
            if (currentRevision !== command.input.expectedDraftRevision) {
              throw new Error("PROPOSAL_DRAFT_CONFLICT");
            }
            const pricing = objectValue(proposal.get("pricingSnapshot"));
            const nextRevision = currentRevision + 1;
            transaction.update(proposalReference, {
              expiresAt: command.input.expiresAt,
              notes: command.input.notes,
              termsSummary: command.input.termsSummary,
              paymentSchedule: paymentSchedule(
                pricing,
                command.input.retainerDueDate,
                command.input.balanceDueDate,
                command.input.retainerOverrideCents,
              ),
              draftRevision: nextRevision,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            output = {
              proposalId: proposal.id,
              status: "draft",
              draftRevision: nextRevision,
            };
          } else if (command.type === "submit_for_approval") {
            transaction.update(proposalReference, {
              status: "internal_review",
              submittedAt: timestamp,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            output = {
              proposalId: proposal.id,
              status: "internal_review",
            };
          } else if (command.type === "return_to_draft") {
            const nextRevision =
              (numberValue(proposal.get("draftRevision")) || 1) + 1;
            transaction.update(proposalReference, {
              status: "draft",
              draftRevision: nextRevision,
              approvedAt: null,
              approvedBy: null,
              pdfDocumentId: null,
              pdfState: "not_requested",
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            output = {
              proposalId: proposal.id,
              status: "draft",
              draftRevision: nextRevision,
            };
          } else if (
            command.type === "approve" ||
            command.type === "regenerate_pdf"
          ) {
            if (!canApproveProposal(membership.role)) {
              throw new Error("APPROVAL_PERMISSION_REQUIRED");
            }
            const revision =
              numberValue(proposal.get("draftRevision")) || 1;
            const pdfJobId = stableId(
              "proposal_pdf",
              command.tenantId,
              `${proposal.id}:${revision}:${command.idempotencyKey}`,
            );
            if (command.type === "approve") {
              transaction.update(proposalReference, {
                status: "approved",
                approvedAt: timestamp,
                approvedBy: identity.uid,
                pdfState: "queued",
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            } else {
              transaction.update(proposalReference, {
                pdfState: "queued",
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
            transaction.create(db.doc(`pdfJobs/${pdfJobId}`), {
              id: pdfJobId,
              tenantId: command.tenantId,
              projectId,
              proposalId: proposal.id,
              type: "proposal_pdf",
              status: "queued",
              attempts: 0,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            output = {
              proposalId: proposal.id,
              status: "approved",
              pdfState: "queued",
              pdfJobId,
            };
          } else {
            if (!canSendProposal(membership.role)) {
              throw new Error("SEND_PERMISSION_REQUIRED");
            }
            const pdfDocumentId = stringValue(
              proposal.get("pdfDocumentId"),
            );
            if (!pdfDocumentId) throw new Error("PROPOSAL_PDF_NOT_READY");
            const pdfDocumentReference = db.doc(
              `documents/${pdfDocumentId}`,
            );
            const pdfDocument = await transaction.get(pdfDocumentReference);
            if (
              !pdfDocument.exists ||
              pdfDocument.get("tenantId") !== command.tenantId ||
              pdfDocument.get("projectId") !== projectId ||
              pdfDocument.get("contentType") !== "application/pdf"
            ) {
              throw new Error("PROPOSAL_PDF_INVALID");
            }

            const emailJobId = stableId(
              "proposal_email",
              command.tenantId,
              `${proposal.id}:${command.idempotencyKey}`,
            );
            const recipient = objectValue(proposal.get("clientSnapshot"));
            const emailJobReference = db.doc(`emailJobs/${emailJobId}`);
            const appUrl =
              process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";
            const proposalPath = "/client/proposal";

            // Where "Review proposal" should send them.
            //
            // A client who already has portal access goes straight to the
            // proposal. One who does not used to get that same link, which
            // is an authenticated route — it bounced them to a sign-in page
            // for an account nobody had created, with the studio none the
            // wiser. Sending a proposal now carries its own invitation.
            //
            // Reads before writes: this is a transaction, so the contact is
            // fetched here rather than beside the writes below.
            const projectReference = db.doc(`projects/${projectId}`);
            const projectForSend = await transaction.get(projectReference);
            const clientContactId = stringList(
              projectForSend.get("clientContactIds"),
            )[0];
            const clientContact = clientContactId
              ? await transaction.get(db.doc(`contacts/${clientContactId}`))
              : null;
            const clientEmail = stringValue(recipient.email).toLowerCase();
            const hasPortalAccess = Boolean(
              clientContact?.get("portalUserId"),
            );
            // An invitation is only useful if we know who to attach it to.
            const invitation =
              !hasPortalAccess && clientContactId && clientEmail
                ? mintClientInvitation({
                    tenantId: command.tenantId,
                    projectId,
                    email: clientEmail,
                    appUrl,
                    next: proposalPath,
                  })
                : null;

            const emailJob = {
              id: emailJobId,
              tenantId: command.tenantId,
              projectId,
              proposalId: proposal.id,
              type: "proposal_sent",
              recipient: clientEmail,
              recipientName: stringValue(recipient.displayName),
              actionUrl: invitation
                ? invitation.inviteUrl
                : `${appUrl}${proposalPath}`,
              attachmentDocumentId: pdfDocumentId,
              status: "queued",
              attempts: 0,
              createdAt: timestamp,
              updatedAt: timestamp,
            };

            /**
             * Persist the invitation the email is about to link to.
             *
             * The id is derived from tenant, project and email, so a client
             * invited by hand and then sent a proposal keeps one invitation
             * rather than collecting rival ones. The token is fresh each
             * time, which retires the link in any earlier invitation email
             * — the same thing "Resend invitation" does, and safe here
             * because the client is holding a newer email that works.
             */
            const writeInvitation = () => {
              if (!invitation || !clientContactId) return;
              transaction.set(
                db.doc(`clientInvitations/${invitation.invitationId}`),
                {
                  id: invitation.invitationId,
                  tenantId: command.tenantId,
                  projectId,
                  contactId: clientContactId,
                  email: invitation.email,
                  normalizedEmail: invitation.email,
                  status: "pending",
                  tokenHash: invitation.tokenHash,
                  expiresAt: invitation.expiresAt,
                  acceptedAt: null,
                  acceptedBy: null,
                  revokedAt: null,
                  lastSentAt: timestamp,
                  latestEmailJobId: emailJobId,
                  // The proposal email carries the invitation, so this is
                  // the send that counts.
                  sendCount: 1,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                  createdBy: identity.uid,
                  updatedBy: identity.uid,
                  archivedAt: null,
                },
                { merge: true },
              );
            };

            if (command.type === "send") {
              const project = projectForSend;
              const [versions] = await Promise.all([
                transaction.get(
                  db
                    .collection("proposals")
                    .where("tenantId", "==", command.tenantId)
                    .where("projectId", "==", projectId),
                ),
              ]);
              if (
                !project.exists ||
                !canCreateProposalForProject(String(project.get("state")))
              ) {
                throw new Error("PROJECT_NOT_READY_FOR_PROPOSAL");
              }
              for (const version of versions.docs) {
                if (
                  version.id !== proposal.id &&
                  ["sent", "viewed", "declined", "expired"].includes(
                    String(version.get("status")),
                  )
                ) {
                  transaction.update(version.ref, {
                    status: "superseded",
                    updatedAt: timestamp,
                    updatedBy: identity.uid,
                  });
                }
              }
              writeInvitation();
              transaction.create(emailJobReference, emailJob);
              transaction.update(proposalReference, {
                status: "sent",
                sentAt: timestamp,
                // The draft form defaults the expiry to seven days from when it
                // was opened, so a proposal drafted and left for a week expired
                // before the client ever saw it — production held a draft for an
                // Oct 2027 wedding expiring two days out. A validity window means
                // "this stands for N days from when you receive it", so the clock
                // starts here. A longer window the studio chose is preserved.
                expiresAt: expiryOnSend(
                  proposal.get("expiresAt"),
                  new Date(timestamp),
                ),
                emailJobId,
                emailDeliveryStatus: "queued",
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
              if (project.get("state") === "CONSULTATION") {
                transaction.update(projectReference, {
                  state: "PROPOSAL",
                  stateVersion: Number(project.get("stateVersion") ?? 0) + 1,
                  updatedAt: timestamp,
                  updatedBy: identity.uid,
                });
              }
              transaction.update(pdfDocumentReference, {
                visibility: "client",
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
              output = {
                proposalId: proposal.id,
                status: "sent",
                emailJobId,
                storagePath: stringValue(
                  pdfDocument.get("providerFileId"),
                  stringValue(pdfDocument.get("canonicalPath")),
                ),
              };
            } else {
              writeInvitation();
              transaction.create(emailJobReference, emailJob);
              transaction.update(proposalReference, {
                emailJobId,
                emailDeliveryStatus: "queued",
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
              output = {
                proposalId: proposal.id,
                status: currentStatus,
                emailJobId,
                storagePath: stringValue(
                  pdfDocument.get("providerFileId"),
                  stringValue(pdfDocument.get("canonicalPath")),
                ),
              };
            }
          }

          audit(transaction, {
            id: stableId(
              "audit",
              command.tenantId,
              `${executionId}:${command.type}`,
            ),
            tenantId: command.tenantId,
            projectId,
            actorId: identity.uid,
            action: `proposal.${command.type}`,
            proposalId: proposal.id,
            timestamp,
            before,
            after: output,
            userAgent,
            correlationId,
          });
          transaction.create(executionReference, {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            result: output,
            createdAt: timestamp,
          });
          return output;
        },
      );

      if (typeof result.storagePath === "string" && result.storagePath) {
        await getStorage()
          .bucket()
          .file(result.storagePath)
          .setMetadata({
            metadata: {
              scanStatus: "clean",
              visibility: "client",
              trustedGenerator: "studiohub-pdf",
            },
          });
      }

      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "PROPOSAL_COMMAND_FAILED";
      const status =
        message === "FORBIDDEN" ||
        message.endsWith("_PERMISSION_REQUIRED")
          ? 403
          : message.endsWith("_NOT_FOUND")
            ? 404
            : 400;
      response.status(status).json({ error: message });
    }
  },
);
