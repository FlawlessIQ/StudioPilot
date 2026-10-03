import { packageDetails } from "../packages/inclusions.js";
import { expiryOnSend } from "./proposal-expiry.js";
import { createHash } from "node:crypto";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { mintClientInvitation } from "../client/invitation-mint.js";
import { preparePartnerSends, queuePartnerSends } from "../client/partner-invitations.js";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { requireActiveSubscription } from "../saas/entitlement-guard.js";
import { studioHubCors } from "../security/cors.js";
import {
  assertProposalAction,
  canApproveProposal,
  canCreateProposalForProject,
  canSendProposal,
  planUndoAcceptance,
} from "./proposal-domain.js";
import { combineSnapshotPricing } from "../proposals/combined-pricing.js";
import { readPricedSalesTax } from "../billing/sales-tax-pricing.js";
import { isStandingInvoice } from "./invoice-standing.js";
import { paymentScheduleFor, projectProfile } from "../job-kinds/job-kinds.js";
import { queueInquiryFormAnalysis } from "../intake/inquiry-form.js";

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
    /**
     * The couple said yes somewhere else.
     *
     * `PROPOSAL → CONTRACT_PENDING` is evidence-controlled, and the only thing
     * that could produce that evidence was the client clicking Accept in the
     * portal. A couple who replied by email, said yes on the phone, or never
     * opened their portal at all left the job stuck at Proposal with no way
     * forward: `transitionProject` refuses the move, and the proposal screen
     * offered only "Resend branded email".
     *
     * This records what happened rather than asserting the state — who said
     * yes, when, and how the studio heard it — and the proposal carries
     * `acceptanceAuthority: "studio_attested"` so a vouched-for acceptance is
     * never mistaken for one the client made themselves.
     */
    type: z.literal("record_acceptance"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      proposalId: z.string().min(1),
      /** Who accepted, in the studio's words. */
      acceptedBy: z.string().min(1).max(160),
      acceptedAt: z.string().date(),
      /** How the studio heard it: "Replied by email", "Said yes on the call". */
      method: z.string().min(1).max(200),
      attestation: z.literal(true),
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
      /**
       * Correct a proposal that has already gone out.
       *
       * A proposal freezes the client and event it was written for, and that
       * immutability is right: a sent quote must still read the way the client
       * read it. But it left a studio with no way to fix a mistake. The
       * reference studio typed a client email with a deliberate typo, sent the
       * proposal four times, and every send succeeded — to an address nobody
       * reads. Editing the client afterwards would not have helped him either,
       * because the wrong address was already frozen into `clientSnapshot`.
       *
       * So this supersedes rather than mutates. `version` and a `superseded`
       * status have been in the schema since it was written and the workspace
       * already renders "Version history"; what was missing was the act that
       * uses them.
       */
      "reissue",
      // Price the proposal again from the job's current packages — see
      // proposal-domain.ts.
      "revise_packages",
      // Throw away a draft, or take back a sent proposal — proposal-domain.ts.
      "discard_draft",
      "withdraw",
      // An acceptance recorded by mistake, taken back — proposal-domain.ts
      // planUndoAcceptance.
      "undo_acceptance",
    ]),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      proposalId: z.string().min(1),
      /** Why a sent proposal was withdrawn, for the studio's own record. */
      reason: z.string().trim().max(500).optional(),
    }),
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

/**
 * The payment lines, by how this job is paid (job-kinds.ts, paymentScheduleFor).
 * A deposit job keeps "Retainer" then "Final balance"; a family session paid in
 * full gets one "Payment in full" line, a sports day one "Payment on the day",
 * so the proposal never shows a retainer and balance nobody will be billed.
 */
function paymentSchedule(
  packageData: Record<string, unknown>,
  retainerDueDate: string | null,
  balanceDueDate: string | null,
  retainerOverrideCents: number | null | undefined,
  project: unknown,
) {
  const totalCents = numberValue(packageData.totalCents);
  // Never more than the total: a deposit larger than the price would make
  // the final balance negative.
  const retainerCents =
    typeof retainerOverrideCents === "number"
      ? Math.min(retainerOverrideCents, totalCents)
      : numberValue(packageData.retainerCents);
  const fields = (project && typeof project === "object" ? project : {}) as { eventDate?: unknown };
  return paymentScheduleFor(projectProfile(project).payment, {
    totalCents,
    retainerCents,
    retainerDueDate,
    balanceDueDate,
    eventDate: typeof fields.eventDate === "string" ? fields.eventDate : null,
  });
}

function lineItems(packageData: Record<string, unknown>) {
  const basePriceCents = numberValue(packageData.basePriceCents);
  const addOns = Array.isArray(packageData.addOns)
    ? packageData.addOns.map(objectValue)
    : [];
  // Typed, so a document can tell the package from its add-ons (H2). A
  // line written before this reads as a package line.
  return [
    {
      description: stringValue(packageData.packageName, "Photography package"),
      quantity: 1,
      unitPriceCents: basePriceCents,
      totalCents: basePriceCents,
      kind: "package" as const,
      sourceId: stringValue(packageData.packageId) || null,
    },
    ...addOns.map((item) => ({
      description: stringValue(item.name, "Add-on"),
      quantity: Math.max(1, numberValue(item.quantity)),
      unitPriceCents: numberValue(item.unitPriceCents),
      totalCents: numberValue(item.lineTotalCents),
      kind: "add_on" as const,
      sourceId: stringValue(item.addOnId) || null,
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
      // Whole-product billing gate (studio commands require a live subscription).
      await requireActiveSubscription(db, command.tenantId);
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
            // A kind with no consultation (a family session, a sports day —
            // job-kinds.ts) goes from the first reply straight to pricing.
            // It used to be refused here until the studio clicked "Confirm
            // we've spoken" about a call that was never part of the job
            // (walk, 2026-10-03). The job steps through CONSULTATION with the
            // proposal, so the state machine keeps its one path.
            const skipsConsultation =
              String(project.get("state")) === "LEAD" &&
              !projectProfile(project.data()).consultation;
            if (
              !canCreateProposalForProject(String(project.get("state"))) &&
              !skipsConsultation
            ) {
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
            /**
             * The second package, when the job has one.
             *
             * `packageSnapshotId` stays the primary — the booking gate,
             * readiness and the invoice scheduler all resolve it — and a photo
             * + video job carries the other alongside it. One proposal, one
             * total, both sets of lines.
             */
            const additionalSnapshotIds = stringList(
              project.get("additionalPackageSnapshotIds"),
            );
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
            /**
             * Read after the primary rather than in the same Promise.all,
             * because the ids come from the project document that call
             * returns. Each is tenant-checked: a snapshot id is not a
             * capability.
             */
            const additionalSnapshots = (
              await Promise.all(
                additionalSnapshotIds
                  .slice(0, 3)
                  .map((id) =>
                    transaction.get(db.doc(`packageSnapshots/${id}`)),
                  ),
              )
            ).filter(
              (snapshot) =>
                snapshot.exists &&
                snapshot.get("tenantId") === command.tenantId,
            );
            const additionalPackageData = additionalSnapshots.map((snapshot) =>
              objectValue(snapshot.data()),
            );
            // Each snapshot carries the discount the studio applied when
            // locking it. Not recomputed here, and never invented: there is
            // no automatic bundle discount.
            const combinedPricing = combineSnapshotPricing(
              [packageData, ...additionalPackageData].map((data) => ({
                packageName: stringValue(data.packageName, "Coverage package"),
                currency: stringValue(data.currency, "USD"),
                subtotalCents: numberValue(data.subtotalCents),
                discountCents: numberValue(data.discountCents),
                taxCents: numberValue(data.taxCents),
                retainerCents: numberValue(data.retainerCents),
                totalCents: numberValue(data.totalCents),
                // Pre-tax "plus sales tax" when QuickBooks works it out; carried to the proposal.
                salesTax: readPricedSalesTax(data.salesTax),
                lineItems: lineItems(data),
              })),
            );
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
              additionalPackageSnapshotIds: additionalSnapshotIds,
              pricingSnapshot: combinedPricing,
              // Each package's "what's included" as bullets, for the couple's
              // page, which can't read package snapshots.
              packageDetails: packageDetails([
                { id: packageSnapshotId, data: packageData },
                ...additionalSnapshots.map((snapshot) => ({
                  id: snapshot.id,
                  data: objectValue(snapshot.data()),
                })),
              ]),
              // From the combined pricing the proposal carries, not the
              // primary package: a second package's price was missing from
              // the schedule until the draft was next saved (H2, M4).
              paymentSchedule: paymentSchedule(
                combinedPricing,
                command.input.retainerDueDate,
                command.input.balanceDueDate,
                command.input.retainerOverrideCents,
                project.data(),
              ),
              retainerOverrideCents:
                typeof command.input.retainerOverrideCents === "number"
                  ? command.input.retainerOverrideCents
                  : null,
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
            if (skipsConsultation) {
              const priorStateVersion = numberValue(project.get("stateVersion"));
              transaction.update(projectReference, {
                state: "CONSULTATION",
                stateVersion: priorStateVersion + 1,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
              const stepAuditId = stableId("audit", command.tenantId, `${executionId}:no-consultation`);
              transaction.create(db.doc(`auditEvents/${stepAuditId}`), {
                id: stepAuditId,
                tenantId: command.tenantId,
                projectId: project.id,
                actorId: identity.uid,
                actorType: "user",
                action: "project.consultation_not_part_of_kind",
                entityType: "project",
                entityId: project.id,
                timestamp,
                before: { state: "LEAD", stateVersion: priorStateVersion },
                after: { state: "CONSULTATION", stateVersion: priorStateVersion + 1 },
                ipAddress: null,
                userAgent,
                correlationId,
                automationRunId: null,
                providerEventId: null,
              });
            }
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
          // A proposal sent inside a booking agreement (H2) is answered by
          // signing that agreement. Resending it alone, re-issuing it or
          // recording an acceptance would each move the price or the job out
          // from under the agreement the couple is signing, so they wait
          // until the agreement is withdrawn.
          const combinedContractId = stringValue(proposal.get("combinedContractId"));
          if (
            combinedContractId &&
            ["resend", "reissue", "record_acceptance", "send", "discard_draft", "withdraw"].includes(command.type)
          ) {
            const combined = await transaction.get(db.doc(`contracts/${combinedContractId}`));
            if (combined.exists && !["voided", "failed", "superseded"].includes(stringValue(combined.get("status")))) {
              throw new Error("PROPOSAL_IN_BOOKING_AGREEMENT");
            }
          }
          const before = {
            status: currentStatus,
            draftRevision: numberValue(proposal.get("draftRevision")) || 1,
            pdfDocumentId: proposal.get("pdfDocumentId") ?? null,
            // So a resend that moved the expiry shows where it moved from.
            expiresAt: proposal.get("expiresAt") ?? null,
          };
          let output: CommandResult;

          if (command.type === "undo_acceptance") {
            // The same authority that may record an acceptance may take one
            // back; the couple's own acceptance too, which the UI says.
            if (!canApproveProposal(membership.role)) {
              throw new Error("APPROVAL_PERMISSION_REQUIRED");
            }
            const projectReference = db.doc(`projects/${projectId}`);
            const orchestrationReference = db.doc(`bookingOrchestrations/${projectId}`);
            const draftReference = db.doc(`contractDrafts/${projectId}`);
            const decisionTaskReference = db.doc(`tasks/proposal_decision_${proposal.id}`);
            const [project, contracts, invoices, draft, orchestration, decisionTask] = await Promise.all([
              transaction.get(projectReference),
              transaction.get(
                db.collection("contracts").where("tenantId", "==", command.tenantId).where("projectId", "==", projectId),
              ),
              transaction.get(
                db.collection("invoiceReferences").where("tenantId", "==", command.tenantId).where("projectId", "==", projectId),
              ),
              transaction.get(draftReference),
              transaction.get(orchestrationReference),
              transaction.get(decisionTaskReference),
            ]);
            if (!project.exists || project.get("tenantId") !== command.tenantId) {
              throw new Error("PROJECT_NOT_FOUND");
            }
            const draftIsThisProposal =
              draft.exists &&
              draft.get("tenantId") === command.tenantId &&
              draft.get("proposalId") === proposal.id;
            const plan = planUndoAcceptance({
              proposal: {
                status: currentStatus,
                acceptancePriorStatus: proposal.get("acceptancePriorStatus"),
                sentAt: proposal.get("sentAt"),
                viewedAt: proposal.get("viewedAt"),
                acceptanceAuthority: proposal.get("acceptanceAuthority"),
                acceptedWithContractId: proposal.get("acceptedWithContractId"),
                combinedContractId: proposal.get("combinedContractId"),
              },
              projectState: stringValue(project.get("state")),
              contractStatuses: contracts.docs.map((contract) => stringValue(contract.get("status"))),
              draftStatus: draftIsThisProposal ? stringValue(draft.get("status")) : null,
              standingInvoices: invoices.docs.filter((invoice) => {
                const status = stringValue(invoice.get("status"));
                return isStandingInvoice(status) && !["void", "voided", "cancelled"].includes(status);
              }).length,
            });
            if (!plan.ok) throw new Error(plan.refusal);
            transaction.update(proposalReference, {
              status: plan.restoreStatus,
              acceptedAt: null,
              decisionBy: null,
              acceptanceAuthority: null,
              acceptanceEvidence: null,
              acceptancePriorStatus: null,
              // Kept beside the proposal, so the next person to open it can see
              // an acceptance was recorded and taken back, and by whom.
              acceptanceUndone: {
                undoneAt: timestamp,
                undoneBy: identity.uid,
                reason: command.input.reason || null,
                acceptedAt: proposal.get("acceptedAt") ?? null,
                acceptedByCouple: plan.acceptedByCouple,
              },
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            const priorStateVersion = numberValue(project.get("stateVersion"));
            transaction.update(projectReference, {
              state: "PROPOSAL",
              stateVersion: priorStateVersion + 1,
              nextAction: "Waiting for the couple to accept the proposal",
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            // Written from a deal that is no longer agreed, and never sent.
            if (plan.discardDraft) {
              transaction.update(draftReference, {
                status: "discarded",
                discardedAt: timestamp,
                discardedReason: "The acceptance it was written from was undone.",
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
            // Nothing should follow a signature that is no longer coming.
            const stoppedPlan =
              orchestration.exists &&
              orchestration.get("tenantId") === command.tenantId &&
              ["active", "needs_attention"].includes(stringValue(orchestration.get("status")));
            if (stoppedPlan) {
              transaction.update(orchestrationReference, {
                status: "cancelled",
                currentStep: "cancelled",
                cancelledAt: timestamp,
                cancelledReason: "acceptance_undone",
                updatedAt: timestamp,
              });
            }
            // "Prepare client agreement" was for the acceptance just undone.
            if (
              decisionTask.exists &&
              !["complete", "completed", "cancelled"].includes(stringValue(decisionTask.get("status")))
            ) {
              transaction.update(decisionTaskReference, {
                status: "cancelled",
                cancelledAt: timestamp,
                cancelledBy: identity.uid,
                cancelReason: "The acceptance was undone.",
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
            const undoAuditId = stableId("audit_acceptance_undone", command.tenantId, command.idempotencyKey);
            transaction.create(db.doc(`auditEvents/${undoAuditId}`), {
              id: undoAuditId,
              tenantId: command.tenantId,
              projectId,
              actorId: identity.uid,
              actorType: "user",
              action: "proposal.acceptance_undone",
              entityType: "proposal",
              entityId: proposal.id,
              timestamp,
              before: {
                status: "accepted",
                projectState: "CONTRACT_PENDING",
                stateVersion: priorStateVersion,
                acceptanceAuthority: proposal.get("acceptanceAuthority") ?? null,
              },
              after: {
                status: plan.restoreStatus,
                projectState: "PROPOSAL",
                stateVersion: priorStateVersion + 1,
                discardedContractDraft: plan.discardDraft,
                stoppedBookingPlan: stoppedPlan,
                reason: command.input.reason || null,
              },
              ipAddress: request.ip ?? null,
              userAgent,
              correlationId,
              automationRunId: null,
              providerEventId: null,
            });
            const undone = {
              proposalId: proposal.id,
              status: plan.restoreStatus,
              projectState: "PROPOSAL",
              discardedContractDraft: plan.discardDraft,
              stoppedBookingPlan: stoppedPlan,
            };
            transaction.create(executionReference, {
              tenantId: command.tenantId,
              idempotencyKey: command.idempotencyKey,
              result: undone,
              createdAt: timestamp,
            });
            return undone;
          }

          if (command.type === "record_acceptance") {
            // The same authority that may send a proposal may record that it
            // was accepted: both are the studio speaking for the client
            // relationship, and both are audited as such.
            if (!canSendProposal(membership.role)) {
              throw new Error("ACCEPTANCE_PERMISSION_REQUIRED");
            }
            // `proposal`, `projectId` and the access check come from the
            // shared read above this branch.
            const projectReference = db.doc(`projects/${projectId}`);
            const project = await transaction.get(projectReference);
            if (
              !project.exists ||
              project.get("tenantId") !== command.tenantId
            ) {
              throw new Error("PROJECT_NOT_FOUND");
            }
            // `assertProposalAction` above has already refused anything but an
            // approved, sent or viewed proposal — which also covers "already
            // accepted", and keeps a draft from becoming an agreement.
            const priorStatus = currentStatus;
            const projectState = stringValue(project.get("state"));
            /**
             * CONSULTATION counts, and it is the case that matters.
             *
             * `PROPOSAL` is only ever set by the `send` command. A studio that
             * emailed their own PDF never sent through StudioCue, so the job
             * sits at CONSULTATION with an approved proposal on it — exactly
             * the studio this control exists for. Refusing them was the first
             * version of this guard being written against the happy path.
             *
             * The state machine has no CONSULTATION → CONTRACT_PENDING edge,
             * and inventing one would be wrong: the job really did pass
             * through proposal. So both hops are recorded, the version moves
             * by two, and the audit log shows the sequence that happened
             * rather than a jump.
             */
            if (!["CONSULTATION", "PROPOSAL"].includes(projectState)) {
              throw new Error("PROJECT_NOT_AWAITING_ACCEPTANCE");
            }
            const hops = projectState === "PROPOSAL" ? 1 : 2;
            transaction.update(proposalReference, {
              status: "accepted",
              acceptedAt: `${command.input.acceptedAt}T00:00:00.000Z`,
              declinedAt: null,
              declineReason: null,
              decisionBy: identity.uid,
              // Never "client": everything downstream reads this to tell an
              // acceptance the couple made from one the studio vouched for.
              acceptanceAuthority: "studio_attested",
              // Where it goes back to if this acceptance is undone.
              acceptancePriorStatus: priorStatus,
              acceptanceEvidence: {
                kind: "manual_attestation",
                acceptedBy: command.input.acceptedBy,
                acceptedAt: command.input.acceptedAt,
                method: command.input.method,
                attestedBy: identity.uid,
                attestedAt: timestamp,
              },
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            const priorStateVersion = Number(project.get("stateVersion") ?? 0);
            transaction.update(projectReference, {
              state: "CONTRACT_PENDING",
              stateVersion: priorStateVersion + hops,
              nextAction: "Prepare and send the photography agreement",
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            if (hops === 2) {
              // The intermediate hop, recorded as its own event so the trail
              // reads CONSULTATION → PROPOSAL → CONTRACT_PENDING.
              const proposalStageAuditId = stableId(
                "audit_proposal_stage",
                command.tenantId,
                command.idempotencyKey,
              );
              transaction.create(db.doc(`auditEvents/${proposalStageAuditId}`), {
                id: proposalStageAuditId,
                tenantId: command.tenantId,
                projectId,
                actorId: identity.uid,
                actorType: "user",
                action: "project.state_changed",
                entityType: "project",
                entityId: projectId,
                timestamp,
                before: { state: "CONSULTATION", stateVersion: priorStateVersion },
                after: {
                  state: "PROPOSAL",
                  stateVersion: priorStateVersion + 1,
                  reason:
                    "Proposal was delivered outside StudioCue and accepted",
                },
                ipAddress: request.ip ?? null,
                userAgent,
                correlationId,
                automationRunId: null,
                providerEventId: null,
              });
            }
            const acceptanceAuditId = stableId(
              "audit_proposal_attested",
              command.tenantId,
              command.idempotencyKey,
            );
            transaction.create(db.doc(`auditEvents/${acceptanceAuditId}`), {
              id: acceptanceAuditId,
              tenantId: command.tenantId,
              projectId,
              actorId: identity.uid,
              // A person, not the client. The portal path writes "client".
              actorType: "user",
              action: "proposal.acceptance_attested",
              entityType: "proposal",
              entityId: proposal.id,
              timestamp,
              before: { status: priorStatus, projectState },
              after: {
                status: "accepted",
                projectState: "CONTRACT_PENDING",
                acceptedBy: command.input.acceptedBy,
                acceptedAt: command.input.acceptedAt,
                method: command.input.method,
              },
              ipAddress: request.ip ?? null,
              userAgent,
              correlationId,
              automationRunId: null,
              providerEventId: null,
            });
            const output = {
              proposalId: proposal.id,
              status: "accepted",
              projectState: "CONTRACT_PENDING",
              alreadyComplete: false,
            };
            transaction.create(executionReference, {
              tenantId: command.tenantId,
              idempotencyKey: command.idempotencyKey,
              result: output,
              createdAt: timestamp,
            });
            return output;
          }

          if (command.type === "update_draft") {
            assertFutureExpiration(command.input.expiresAt);
            const currentRevision =
              numberValue(proposal.get("draftRevision")) || 1;
            if (currentRevision !== command.input.expectedDraftRevision) {
              throw new Error("PROPOSAL_DRAFT_CONFLICT");
            }
            const pricing = objectValue(proposal.get("pricingSnapshot"));
            const nextRevision = currentRevision + 1;
            /**
             * Left out means "as it was"; null means "back to the packages'".
             * Every save from the draft page and Cue left it out, and each one
             * put a studio's hand-set retainer back to the package's — GR's $10
             * test retainer became $0 (2026-09-30).
             */
            const storedOverride = proposal.get("retainerOverrideCents");
            const retainerOverrideCents =
              command.input.retainerOverrideCents === undefined
                ? typeof storedOverride === "number"
                  ? storedOverride
                  : null
                : command.input.retainerOverrideCents;
            const draftProject = await transaction.get(db.doc(`projects/${projectId}`));
            transaction.update(proposalReference, {
              expiresAt: command.input.expiresAt,
              notes: command.input.notes,
              termsSummary: command.input.termsSummary,
              paymentSchedule: paymentSchedule(
                pricing,
                command.input.retainerDueDate,
                command.input.balanceDueDate,
                retainerOverrideCents,
                draftProject.exists ? draftProject.data() : null,
              ),
              retainerOverrideCents,
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
          } else if (command.type === "discard_draft") {
            if (!canApproveProposal(membership.role)) {
              throw new Error("APPROVAL_PERMISSION_REQUIRED");
            }
            transaction.update(proposalReference, {
              status: "discarded",
              discardedAt: timestamp,
              discardedBy: identity.uid,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            output = { proposalId: proposal.id, status: "discarded" };
          } else if (command.type === "withdraw") {
            if (!canSendProposal(membership.role)) {
              throw new Error("SEND_PERMISSION_REQUIRED");
            }
            transaction.update(proposalReference, {
              status: "withdrawn",
              withdrawnAt: timestamp,
              withdrawnBy: identity.uid,
              withdrawReason: command.input.reason || null,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            output = { proposalId: proposal.id, status: "withdrawn" };
          } else if (command.type === "revise_packages") {
            if (!canApproveProposal(membership.role)) {
              throw new Error("APPROVAL_PERMISSION_REQUIRED");
            }
            const projectReference = db.doc(`projects/${projectId}`);
            const project = await transaction.get(projectReference);
            if (!project.exists || project.get("tenantId") !== command.tenantId) {
              throw new Error("PROJECT_NOT_FOUND");
            }
            const projectState = stringValue(project.get("state"));
            if (!["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING"].includes(projectState)) {
              throw new Error("PACKAGES_LOCKED_AFTER_SIGNING");
            }
            const primaryId = stringValue(project.get("packageSnapshotId"));
            if (!primaryId) throw new Error("PACKAGE_SNAPSHOT_REQUIRED");
            const extraIds = stringList(project.get("additionalPackageSnapshotIds")).slice(0, 3);
            const [snapshots, contracts, invoices, decisionTask] = await Promise.all([
              Promise.all([primaryId, ...extraIds].map((id) => transaction.get(db.doc(`packageSnapshots/${id}`)))),
              transaction.get(
                db.collection("contracts").where("tenantId", "==", command.tenantId).where("projectId", "==", projectId),
              ),
              transaction.get(
                db.collection("invoiceReferences").where("tenantId", "==", command.tenantId).where("projectId", "==", projectId),
              ),
              transaction.get(db.doc(`tasks/proposal_decision_${proposal.id}`)),
            ]);
            const owned = snapshots.filter(
              (snapshot) => snapshot.exists && snapshot.get("tenantId") === command.tenantId,
            );
            if (!owned.length || owned[0]!.id !== primaryId) throw new Error("PACKAGE_SNAPSHOT_INVALID");
            // What has already left the studio is what the couple is holding:
            // an agreement out for signature, or a bill. Those have to be dealt
            // with first, not silently contradicted by a new price.
            const agreementOut = contracts.docs.some((contract) =>
              ["queued", "sent", "delivered", "viewed", "partially_signed", "completed"].includes(
                String(contract.get("status")),
              ),
            );
            if (agreementOut) throw new Error("AGREEMENT_ALREADY_SENT");
            // A standing bill only — see assertPackagesEditable in
            // crm/commands.ts: a failed or superseded attempt is owed by nobody.
            if (
              invoices.docs.some((invoice) => {
                const status = String(invoice.get("status"));
                return isStandingInvoice(status) && !["void", "cancelled"].includes(status);
              })
            ) {
              throw new Error("INVOICE_ALREADY_RAISED");
            }
            const pricing = combineSnapshotPricing(
              owned.map((snapshot) => {
                const data = objectValue(snapshot.data());
                return {
                  packageName: stringValue(data.packageName, "Coverage package"),
                  currency: stringValue(data.currency, "USD"),
                  subtotalCents: numberValue(data.subtotalCents),
                  discountCents: numberValue(data.discountCents),
                  taxCents: numberValue(data.taxCents),
                  retainerCents: numberValue(data.retainerCents),
                  totalCents: numberValue(data.totalCents),
                  // Pre-tax "plus sales tax" when QuickBooks works it out; carried to the proposal.
                  salesTax: readPricedSalesTax(data.salesTax),
                  lineItems: lineItems(data),
                };
              }),
            );
            // The dates the studio already chose carry over; the amounts follow
            // the new total.
            const priorSchedule = Array.isArray(proposal.get("paymentSchedule"))
              ? (proposal.get("paymentSchedule") as Array<Record<string, unknown>>)
              : [];
            // A retainer the studio set by hand stays set: revising the
            // packages used to drop it back to the package's (H2, M4). A
            // proposal from before the override was stored shows it as a
            // scheduled retainer that differs from its pricing's.
            const storedOverride = proposal.get("retainerOverrideCents");
            const priorPricingRetainer = numberValue(objectValue(proposal.get("pricingSnapshot")).retainerCents);
            const priorScheduledRetainer = Number(priorSchedule[0]?.amountCents);
            const retainerOverrideCents =
              typeof storedOverride === "number"
                ? storedOverride
                : Number.isFinite(priorScheduledRetainer) && priorScheduledRetainer !== priorPricingRetainer
                  ? priorScheduledRetainer
                  : null;
            const schedule = paymentSchedule(
              pricing,
              typeof priorSchedule[0]?.dueDate === "string" ? String(priorSchedule[0].dueDate) : null,
              typeof priorSchedule[1]?.dueDate === "string" ? String(priorSchedule[1].dueDate) : null,
              retainerOverrideCents,
              project.data(),
            );
            const priced = {
              packageSnapshotId: primaryId,
              additionalPackageSnapshotIds: owned.slice(1).map((snapshot) => snapshot.id),
              pricingSnapshot: pricing,
              paymentSchedule: schedule,
              packageDetails: packageDetails(
                owned.map((snapshot) => ({ id: snapshot.id, data: objectValue(snapshot.data()) })),
              ),
            };
            if (["draft", "internal_review", "approved"].includes(currentStatus)) {
              // Nobody outside the studio has seen it: price it again in place,
              // back to draft so it is read and approved at the new total.
              const nextRevision = (numberValue(proposal.get("draftRevision")) || 1) + 1;
              transaction.update(proposalReference, {
                ...priced,
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
                totalCents: pricing.totalCents,
                superseded: false,
              };
            } else {
              const revisedId = stableId("proposal_revision", command.tenantId, command.idempotencyKey);
              const nextVersion = numberValue(proposal.get("version")) + 1;
              transaction.create(db.doc(`proposals/${revisedId}`), {
                ...objectValue(proposal.data()),
                ...priced,
                id: revisedId,
                version: nextVersion,
                status: "draft",
                draftRevision: 1,
                supersedesProposalId: proposal.id,
                submittedAt: null,
                approvedAt: null,
                approvedBy: null,
                sentAt: null,
                viewedAt: null,
                acceptedAt: null,
                acceptedBy: null,
                acceptanceAuthority: null,
                declinedAt: null,
                declineReason: null,
                emailDeliveryStatus: "not_sent",
                emailMessageId: null,
                pdfDocumentId: null,
                pdfState: "not_requested",
                createdAt: timestamp,
                createdBy: identity.uid,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
              transaction.update(proposalReference, {
                status: "superseded",
                supersededByProposalId: revisedId,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
              let reopened = false;
              if (currentStatus === "accepted" && projectState === "CONTRACT_PENDING") {
                // Back to the proposal stage: the couple accepts the revised
                // version, and the agreement follows from that one.
                transaction.update(projectReference, {
                  state: "PROPOSAL",
                  stateVersion: numberValue(project.get("stateVersion")) + 1,
                  nextAction: "Send the revised proposal",
                  updatedAt: timestamp,
                  updatedBy: identity.uid,
                });
                reopened = true;
                // An agreement written from the old version but never sent is
                // now for the wrong packages.
                for (const contract of contracts.docs) {
                  if (String(contract.get("status")) === "draft") {
                    transaction.update(contract.ref, {
                      status: "superseded",
                      supersededReason: "The proposal was revised.",
                      updatedAt: timestamp,
                      updatedBy: identity.uid,
                    });
                  }
                }
                // "Prepare client agreement" was for the old version; the
                // revised one makes its own when it is accepted.
                if (decisionTask.exists && decisionTask.get("status") !== "complete") {
                  transaction.update(decisionTask.ref, {
                    status: "cancelled",
                    updatedAt: timestamp,
                    updatedBy: identity.uid,
                  });
                }
              }
              output = {
                proposalId: revisedId,
                supersededProposalId: proposal.id,
                status: "draft",
                version: nextVersion,
                totalCents: pricing.totalCents,
                superseded: true,
                reopened,
              };
            }
          } else if (command.type === "reissue") {
            if (!canApproveProposal(membership.role)) {
              throw new Error("APPROVAL_PERMISSION_REQUIRED");
            }
            // An accepted proposal is the record of a deal. Correcting it would
            // rewrite what the client agreed to.
            if (String(proposal.get("status")) === "accepted") {
              throw new Error("ACCEPTED_PROPOSAL_IS_FINAL");
            }
            if (String(proposal.get("status")) === "superseded") {
              throw new Error("PROPOSAL_ALREADY_SUPERSEDED");
            }
            const projectDocument = await transaction.get(
              db.doc(`projects/${String(proposal.get("projectId"))}`),
            );
            if (
              !projectDocument.exists ||
              projectDocument.get("tenantId") !== command.tenantId
            ) {
              throw new Error("PROJECT_NOT_FOUND");
            }
            /**
             * Re-read the client rather than carrying the old snapshot over.
             *
             * The entire point is that the frozen copy is wrong — a corrected
             * address only reaches the new version if we go back to the record
             * it was frozen from.
             */
            const contactIds = Array.isArray(
              projectDocument.get("clientContactIds"),
            )
              ? (projectDocument.get("clientContactIds") as unknown[])
              : [];
            const contactDocument = contactIds.length
              ? await transaction.get(db.doc(`contacts/${String(contactIds[0])}`))
              : null;
            const freshEmail = stringValue(
              contactDocument?.get("email"),
              stringValue(objectValue(proposal.get("clientSnapshot")).email),
            ).toLowerCase();
            const freshName = stringValue(
              contactDocument?.get("displayName"),
              stringValue(
                objectValue(proposal.get("clientSnapshot")).displayName,
                freshEmail,
              ),
            );
            const nextVersion = numberValue(proposal.get("version")) + 1;
            const reissuedId = stableId(
              "proposal",
              command.tenantId,
              command.idempotencyKey,
            );
            // The new version starts as a draft: a correction is still a
            // document a studio should read before it goes to a client, and
            // the existing approve/send path already does that properly.
            transaction.create(db.doc(`proposals/${reissuedId}`), {
              ...objectValue(proposal.data()),
              id: reissuedId,
              version: nextVersion,
              status: "draft",
              draftRevision: 1,
              clientSnapshot: { displayName: freshName, email: freshEmail },
              eventSnapshot: {
                name: stringValue(
                  projectDocument.get("name"),
                  stringValue(objectValue(proposal.get("eventSnapshot")).name),
                ),
                eventType: stringValue(
                  projectDocument.get("eventType"),
                  stringValue(objectValue(proposal.get("eventSnapshot")).eventType),
                ),
                eventDate: stringValue(
                  projectDocument.get("eventDate"),
                  stringValue(objectValue(proposal.get("eventSnapshot")).eventDate),
                ),
                timezone: stringValue(projectDocument.get("timezone"), "UTC"),
                venue: projectDocument.get("venueName") ?? null,
              },
              supersedesProposalId: proposal.id,
              approvedAt: null,
              approvedBy: null,
              sentAt: null,
              viewedAt: null,
              emailDeliveryStatus: "not_sent",
              emailMessageId: null,
              pdfDocumentId: null,
              pdfState: "not_requested",
              createdAt: timestamp,
              createdBy: identity.uid,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            transaction.update(proposalReference, {
              status: "superseded",
              supersededByProposalId: reissuedId,
              updatedAt: timestamp,
              updatedBy: identity.uid,
            });
            output = {
              proposalId: reissuedId,
              supersededProposalId: proposal.id,
              status: "draft",
              version: nextVersion,
              /**
               * Surfaced so the screen can say "this will now go to X instead
               * of Y" — the correction that matters most is usually the one
               * nobody can see.
               */
              recipientChanged:
                freshEmail !==
                stringValue(objectValue(proposal.get("clientSnapshot")).email),
              recipient: freshEmail,
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
            /**
             * A dead-lettered PDF must not freeze the proposal forever.
             *
             * Requiring the document unconditionally meant one exhausted PDF
             * job made a proposal permanently unsendable, with no override
             * anywhere — the studio could not send it, could not withdraw it,
             * and regenerating hit the same failing worker. The couple never
             * heard anything.
             *
             * The gate stays shut while there is still a reason to wait:
             * `not_requested` and `queued` both mean the document is coming,
             * and sending then would drop an attachment that was about to
             * exist. `failed` is the terminal state the runner writes after
             * retries are exhausted, and past that point waiting is not a
             * plan.
             *
             * Sending without it is sound because the PDF is an attachment,
             * not the proposal. The couple reviews pricing and terms in the
             * portal, rendered from the proposal record itself — no client
             * surface reads `pdfDocumentId`. They can accept normally; the
             * studio loses the attachment, not the agreement, and the
             * proposal records that so the audit trail does not imply a
             * document that was never sent.
             */
            const pdfFailed =
              stringValue(proposal.get("pdfState")) === "failed";
            if (!pdfDocumentId && !pdfFailed) {
              throw new Error("PROPOSAL_PDF_NOT_READY");
            }
            /**
             * A failed PDF never attaches, even if an identifier survives.
             *
             * `regenerate_pdf` leaves the previous `pdfDocumentId` in place
             * while the retry runs, so a proposal can hold a stale identifier
             * and a `failed` state at once. Validating that document would
             * throw `PROPOSAL_PDF_INVALID` and put the proposal straight back
             * in the trap this guard exists to open.
             */
            const pdfDocumentReference =
              pdfDocumentId && !pdfFailed
                ? db.doc(`documents/${pdfDocumentId}`)
                : null;
            const pdfDocument = pdfDocumentReference
              ? await transaction.get(pdfDocumentReference)
              : null;
            if (
              pdfDocument &&
              (!pdfDocument.exists ||
                pdfDocument.get("tenantId") !== command.tenantId ||
                pdfDocument.get("projectId") !== projectId ||
                pdfDocument.get("contentType") !== "application/pdf")
            ) {
              throw new Error("PROPOSAL_PDF_INVALID");
            }
            // Only a document that passed the checks above may be attached.
            const attachableDocumentId = pdfDocument ? pdfDocumentId : null;

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
            // The partner copied on this email gets their own copy with their
            // own link when anyone's is an invitation (partner-invitations.ts).
            const partnerSends = await preparePartnerSends(
              db,
              (reference) => transaction.get(reference),
              {
                tenantId: command.tenantId,
                projectId,
                clientContactIds: projectForSend.get("clientContactIds"),
                primaryContactId: clientContactId ?? "",
                primaryEmail: clientEmail,
                primaryNeedsInvite: invitation !== null,
                primaryEmailJobId: emailJobId,
                appUrl,
                path: proposalPath,
                actorId: identity.uid,
                now: timestamp,
              },
            );

            const emailJob = {
              id: emailJobId,
              soleRecipient: partnerSends.length > 0,
              tenantId: command.tenantId,
              projectId,
              proposalId: proposal.id,
              type: "proposal_sent",
              recipient: clientEmail,
              recipientName: stringValue(recipient.displayName),
              actionUrl: invitation
                ? invitation.inviteUrl
                : `${appUrl}${proposalPath}`,
              attachmentDocumentId: attachableDocumentId,
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
              queuePartnerSends(db, transaction, emailJob, partnerSends);
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
              // Nothing to reveal to the client when the PDF dead-lettered.
              if (pdfDocumentReference) {
                transaction.update(pdfDocumentReference, {
                  visibility: "client",
                  updatedAt: timestamp,
                  updatedBy: identity.uid,
                });
              }
              output = {
                proposalId: proposal.id,
                status: "sent",
                emailJobId,
                storagePath: pdfDocument
                  ? stringValue(
                      pdfDocument.get("providerFileId"),
                      stringValue(pdfDocument.get("canonicalPath")),
                    )
                  : null,
                /**
                 * Sent with no attachment, said plainly.
                 *
                 * The studio needs to know the couple got a link and not a
                 * document, so the workspace can tell them and offer the
                 * regenerate they will want once the worker is healthy.
                 */
                sentWithoutDocument: !pdfDocument,
              };
            } else {
              /**
               * A resend re-opens the offer, as a send does.
               *
               * Nothing writes `expired`: the couple's page computes it from
               * this date and the decision refuses a yes past it. Resending a
               * lapsed proposal left the date alone, so the couple was emailed
               * an offer the server would refuse. The same floor as `send` —
               * seven days from now, or the studio's later date — so a lapsed
               * or nearly-lapsed proposal is extended, and a longer window
               * is kept. The audit event records both dates.
               */
              const priorExpiresAt = proposal.get("expiresAt");
              const expiresAt = expiryOnSend(priorExpiresAt, new Date(timestamp));
              const expiryExtended =
                Date.parse(expiresAt) !== Date.parse(String(priorExpiresAt ?? ""));
              writeInvitation();
              transaction.create(emailJobReference, emailJob);
              transaction.update(proposalReference, {
                ...(expiryExtended ? { expiresAt } : {}),
                emailJobId,
                emailDeliveryStatus: "queued",
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
              output = {
                proposalId: proposal.id,
                status: currentStatus,
                expiresAt,
                expiryExtended,
                emailJobId,
                storagePath: pdfDocument
                  ? stringValue(
                      pdfDocument.get("providerFileId"),
                      stringValue(pdfDocument.get("canonicalPath")),
                    )
                  : null,
                /**
                 * Sent with no attachment, said plainly.
                 *
                 * The studio needs to know the couple got a link and not a
                 * document, so the workspace can tell them and offer the
                 * regenerate they will want once the worker is healthy.
                 */
                sentWithoutDocument: !pdfDocument,
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

      // A job that reached the proposal with no call booked through StudioCue:
      // the event form the couple sent from their inquiry page waited for a
      // moment like this one (intake/inquiry-form.ts). Queued once.
      if (command.type === "send" && result.status === "sent") {
        const sent = await db.doc(`proposals/${command.input.proposalId}`).get();
        const sentProjectId = stringValue(sent.get("projectId"));
        if (sentProjectId) {
          await queueInquiryFormAnalysis(db, {
            tenantId: command.tenantId,
            projectId: sentProjectId,
            now: new Date().toISOString(),
          });
        }
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
