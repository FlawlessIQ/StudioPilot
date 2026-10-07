import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { invitationLinkFields, mintClientInvitation } from "../client/invitation-mint.js";
import { preparePartnerSends, queuePartnerSends } from "../client/partner-invitations.js";
import { clientOutreachStop, mayContactClient } from "../post-event/client-outreach.js";
import { requireOwnerOrAdmin, stableId, type CommandContext } from "./commands.js";
import { resendBlockedUntil, signedCopyRetryPlan } from "./resend.js";

/**
 * After a StudioCue contract has gone out: the studio's follow-ups.
 *
 * resendContract    email the couple the agreement to sign again, now
 * retrySignedCopy   make the signed copy again when making it gave up
 *
 * Dispatched from bookingCommand like the rest of ./commands.ts.
 */

export const resendContractInput = z.object({
  projectId: z.string().min(1),
  contractId: z.string().min(1),
});

export const retrySignedCopyInput = z.object({
  contractId: z.string().min(1),
});

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * The couple lost the email, or it went to spam, or the studio is about to
 * call them. The reminders go at 3 and 7 days (./reminders.ts); this is the
 * one they can send now. The same "ready to sign" email, under a new job id so
 * it is a new send, and read against the contract again by the email worker as
 * it goes. At most once an hour.
 */
export async function resendContract(context: CommandContext, input: z.infer<typeof resendContractInput>) {
  requireOwnerOrAdmin(context.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED");
  const db = getFirestore();
  const contractReference = db.doc(`contracts/${input.contractId}`);
  const [contract, project] = await Promise.all([
    contractReference.get(),
    db.doc(`projects/${input.projectId}`).get(),
  ]);
  if (
    !contract.exists ||
    contract.get("tenantId") !== context.tenantId ||
    contract.get("projectId") !== input.projectId
  )
    throw new Error("CONTRACT_NOT_FOUND");
  if (contract.get("provider") !== "studiocue") throw new Error("NOT_A_STUDIOCUE_CONTRACT");
  if (!["sent", "viewed"].includes(text(contract.get("status")))) throw new Error("CONTRACT_NOT_AWAITING_SIGNATURE");
  const projectData = project.exists && project.get("tenantId") === context.tenantId ? project.data() : null;
  if (!mayContactClient(projectData))
    throw new Error(`CLIENT_OUTREACH_STOPPED:${clientOutreachStop(projectData) ?? "job_missing"}`);
  const combined = contract.get("mode") === "combined";
  if (combined) {
    // Its prices are the proposal's; once those lapse the couple can't sign
    // it, and the email would only take them to a refusal.
    const proposal = await db.doc(`proposals/${text(contract.get("proposalId"))}`).get();
    const expiresAt = Date.parse(text(proposal.get("expiresAt")));
    if (!proposal.exists || !Number.isFinite(expiresAt) || expiresAt <= Date.parse(context.timestamp))
      throw new Error("AGREEMENT_PRICES_EXPIRED");
  }
  const signers = Array.isArray(contract.get("signers"))
    ? (contract.get("signers") as Array<Record<string, unknown>>)
    : [];
  const client = signers.find((signer) => signer.role === "primary_client");
  const clientEmail = text(client?.email);
  if (!clientEmail) throw new Error("CLIENT_EMAIL_REQUIRED");
  const studioSigner = signers.find((signer) => signer.role === "studio");
  const clientContactId = Array.isArray(project.get("clientContactIds"))
    ? String((project.get("clientContactIds") as unknown[])[0] ?? "")
    : "";
  const contact = clientContactId ? await db.doc(`contacts/${clientContactId}`).get() : null;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const contractPath = "/client/contract";

  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(contractReference);
    if (!["sent", "viewed"].includes(text(current.get("status")))) throw new Error("CONTRACT_NOT_AWAITING_SIGNATURE");
    const blockedUntil = resendBlockedUntil(
      [current.get("sentAt"), current.get("lastResentAt")],
      Date.parse(context.timestamp),
    );
    if (blockedUntil) throw new Error(`RESEND_TOO_SOON:${blockedUntil}`);
    const count = Number(current.get("resendCount") ?? 0) + 1;
    const invitation =
      !contact?.get("portalUserId") && clientContactId
        ? mintClientInvitation({
            tenantId: context.tenantId,
            projectId: input.projectId,
            email: clientEmail,
            appUrl,
            next: contractPath,
          })
        : null;
    const emailJobId = `contract_ready_${contract.id}_again_${count}`;
    // The partner gets their own copy and link again too, not the first
    // client's (client/partner-invitations.ts).
    const partnerSends = await preparePartnerSends(db, (reference) => transaction.get(reference), {
      tenantId: context.tenantId,
      projectId: input.projectId,
      clientContactIds: project.get("clientContactIds"),
      primaryContactId: clientContactId,
      primaryEmail: clientEmail,
      primaryNeedsInvite: invitation !== null,
      primaryEmailJobId: emailJobId,
      appUrl,
      path: contractPath,
      actorId: context.actorId,
      now: context.timestamp,
    });
    const readyEmail = {
      id: emailJobId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      contractId: contract.id,
      type: "contract_ready",
      // Not the proposal id: on the first send the worker marks the proposal
      // sent from it, and a resend must not touch the proposal.
      ...(combined ? { combined: true } : {}),
      recipient: clientEmail,
      recipientName: text(client?.name) || null,
      actionUrl: invitation ? invitation.inviteUrl : `${appUrl}${contractPath}`,
      signerName: text(studioSigner?.name) || null,
      soleRecipient: partnerSends.length > 0,
      status: "queued",
      attempts: 0,
      createdAt: context.timestamp,
      updatedAt: context.timestamp,
    };
    transaction.create(db.doc(`emailJobs/${emailJobId}`), readyEmail);
    queuePartnerSends(db, transaction, readyEmail, partnerSends);
    if (invitation && clientContactId) {
      transaction.set(
        db.doc(`clientInvitations/${invitation.invitationId}`),
        {
          id: invitation.invitationId,
          tenantId: context.tenantId,
          projectId: input.projectId,
          contactId: clientContactId,
          email: invitation.email,
          normalizedEmail: invitation.email,
          status: "pending",
          ...invitationLinkFields(invitation.tokenHash),
          expiresAt: invitation.expiresAt,
          revokedAt: null,
          lastSentAt: context.timestamp,
          latestEmailJobId: emailJobId,
          sendCount: FieldValue.increment(1),
          updatedAt: context.timestamp,
          updatedBy: context.actorId,
        },
        { merge: true },
      );
    }
    transaction.update(contractReference, { lastResentAt: context.timestamp, resendCount: count });
    const auditId = stableId("audit_contract_resent", context.tenantId, context.idempotencyKey);
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      actorType: "user",
      action: "contract.resent",
      entityType: "contract",
      entityId: contract.id,
      timestamp: context.timestamp,
      before: { resendCount: count - 1 },
      after: { resendCount: count, emailJobId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    return { contractId: contract.id, emailJobId, resendCount: count };
  });
}

/**
 * The signed copy is made after the couple signs (`pdfJobs/contract_seal_{id}`,
 * ../contracts/seal.ts). When that job gave up, the studio's page said "it
 * usually takes a minute" and the couple's said "shortly" — forever. This runs
 * it again from a clean start; the contract itself was complete all along.
 */
export async function retrySignedCopy(context: CommandContext, input: z.infer<typeof retrySignedCopyInput>) {
  requireOwnerOrAdmin(context.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED");
  const db = getFirestore();
  const contract = await db.doc(`contracts/${input.contractId}`).get();
  if (!contract.exists || contract.get("tenantId") !== context.tenantId) throw new Error("CONTRACT_NOT_FOUND");
  if (contract.get("provider") !== "studiocue") throw new Error("NOT_A_STUDIOCUE_CONTRACT");
  // Only a contract the couple signed in StudioCue is sealed; a change filed
  // as a contract (amendment_*) has no seal job to redo.
  if (contract.get("status") !== "completed" || contract.get("amendmentId"))
    throw new Error("SIGNED_COPY_NOT_EXPECTED");
  const jobReference = db.doc(`pdfJobs/contract_seal_${contract.id}`);
  const projectId = text(contract.get("projectId"));
  return db.runTransaction(async (transaction) => {
    const job = await transaction.get(jobReference);
    const plan = signedCopyRetryPlan({ exists: job.exists, status: job.get("status") });
    if (plan === "done") return { contractId: contract.id, status: "succeeded", retried: false };
    if (plan === "in_progress") return { contractId: contract.id, status: text(job.get("status")), retried: false };
    if (plan === "create") {
      transaction.create(jobReference, {
        id: jobReference.id,
        tenantId: context.tenantId,
        projectId,
        contractId: contract.id,
        type: "contract_pdf",
        status: "queued",
        attempts: 0,
        createdAt: context.timestamp,
        updatedAt: context.timestamp,
      });
    } else {
      transaction.update(jobReference, {
        status: "queued",
        // A fresh run: left at the old count, the worker would see a job
        // already at its limit and give up on the first hiccup.
        attempts: 0,
        error: null,
        nextAttemptAt: null,
        completedAt: null,
        retriedAt: context.timestamp,
        retriedBy: context.actorId,
        updatedAt: context.timestamp,
      });
    }
    const auditId = stableId("audit_signed_copy_retried", context.tenantId, context.idempotencyKey);
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: context.tenantId,
      projectId: projectId || null,
      actorId: context.actorId,
      actorType: "user",
      action: "contract.signed_copy_retried",
      entityType: "pdfJob",
      entityId: jobReference.id,
      timestamp: context.timestamp,
      before: { status: job.exists ? job.get("status") : null },
      after: { status: "queued" },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    return { contractId: contract.id, status: "queued", retried: true };
  });
}
