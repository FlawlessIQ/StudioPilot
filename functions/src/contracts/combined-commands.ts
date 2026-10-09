import { detailsForLine } from "../packages/inclusions.js";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { expiryOnSend } from "../booking/proposal-expiry.js";
import { invitationLinkFields, mintClientInvitation } from "../client/invitation-mint.js";
import { preparePartnerSends, queuePartnerSends } from "../client/partner-invitations.js";
import { requireProviderForTenant } from "../integrations/capability-resolution.js";
import {
  DEAD_CONTRACT_STATUSES,
  NATIVE_SIGNING_GENERALLY_AVAILABLE,
  STUDIO_SIGNING_CONSENT_VERSION,
  STUDIO_SIGNING_STATEMENT,
  requireOwnerOrAdmin,
  resolveDraft,
  stableId,
  type CommandContext,
} from "./commands.js";
import { buildCombinedAgreement, sectionDocument, type CombinedSection } from "./combined.js";
import { tenantTrade } from "../trades/tenant-trade.js";
import { tradeProfile, type Trade } from "../trades/trades.js";
import { readPricedSalesTax } from "../billing/sales-tax-pricing.js";
import { contractDocumentSchema, type ContractDocument } from "./document.js";
import { contractDocumentHash, sha256Text } from "./document-hash.js";

/**
 * One send, two signatures: the studio side (H2 Part B,
 * docs/proposal-agreement-and-addons-plan-2026-09-28.md).
 *
 * In place of "send the proposal, wait, prepare the contract, send it", the
 * studio sends one booking agreement: Part 1 its own terms, Part 2 the
 * packages, extras, total and schedule from the proposal. The owner signs
 * both parts for the studio as they send, as for any contract (esign D1). The
 * couple then reads and signs each part in one sitting, which both accepts
 * the proposal and signs the contract (server/contracts/combined-signing.ts).
 *
 * On by default for a trade that books in one link (trades.ts
 * `journey.oneLinkBooking`: a DJ, a makeup artist, a hair stylist — their
 * client signs and pays the deposit in one visit). A photographer studio
 * still needs a platform admin to turn `tenantFeatures.combinedAgreement` on
 * — counsel has still to see the two-signature ceremony.
 */

const SENDABLE_PROPOSAL_STATUSES = new Set(["draft", "internal_review", "approved", "sent", "viewed"]);
const PROJECT_STATES = new Set(["CONSULTATION", "PROPOSAL"]);

export const combinedAgreementInput = z.object({
  projectId: z.string().min(1),
  proposalId: z.string().min(1),
  overrides: z.record(z.string(), z.string().max(2000)).default({}),
});

export const sendCombinedAgreementInput = combinedAgreementInput.extend({
  /** The hash of the agreement the studio read. A change since then refuses the send. */
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  studioSignerName: z.string().trim().min(2).max(160),
  consent: z.literal(true),
});

/**
 * The server's half of features/contracts/rollout.ts `combinedAgreementOn`:
 * native signing, and either the studio's own switch or a trade that books in
 * one link. `trade` when the caller has already read it.
 */
export async function combinedAgreementEnabled(db: Firestore, tenantId: string, trade?: Trade): Promise<boolean> {
  const [features, studioTrade] = await Promise.all([
    db.doc(`tenantFeatures/${tenantId}`).get(),
    trade ?? tenantTrade(db, tenantId),
  ]);
  const native = NATIVE_SIGNING_GENERALLY_AVAILABLE || features.get("nativeContractSigning") === true;
  return native && (features.get("combinedAgreement") === true || tradeProfile(studioTrade).journey.oneLinkBooking);
}

type SectionWithHash = CombinedSection & { hash: string };

/** The agreement as it would be sent today, from the records. */
async function resolveCombined(
  db: Firestore,
  context: CommandContext,
  input: z.infer<typeof combinedAgreementInput>,
) {
  // The studio's trade names Part 2 (a photographer's "coverage", a vendor's
  // "service" — combined.ts) and decides whether this is on by default. Read
  // on preview and on send alike, so the document the studio signed is the
  // one that goes.
  const trade = await tenantTrade(db, context.tenantId);
  if (!(await combinedAgreementEnabled(db, context.tenantId, trade))) throw new Error("COMBINED_AGREEMENT_NOT_ENABLED");
  const [project, proposal] = await Promise.all([
    db.doc(`projects/${input.projectId}`).get(),
    db.doc(`proposals/${input.proposalId}`).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
  if (!PROJECT_STATES.has(String(project.get("state")))) throw new Error("PROJECT_NOT_READY_FOR_PROPOSAL");
  if (
    !proposal.exists ||
    proposal.get("tenantId") !== context.tenantId ||
    proposal.get("projectId") !== input.projectId
  )
    throw new Error("PROPOSAL_NOT_FOUND");
  if (!SENDABLE_PROPOSAL_STATUSES.has(String(proposal.get("status")))) throw new Error("PROPOSAL_NOT_SENDABLE");
  const draft = await resolveDraft(db, {
    tenantId: context.tenantId,
    projectId: input.projectId,
    proposalId: input.proposalId,
    templateVersionId: null,
    overrides: input.overrides,
    today: context.timestamp.slice(0, 10),
  });
  const pricing = (proposal.get("pricingSnapshot") ?? {}) as Record<string, unknown>;
  const schedule = Array.isArray(proposal.get("paymentSchedule"))
    ? (proposal.get("paymentSchedule") as Array<Record<string, unknown>>)
    : [];
  const lines = Array.isArray(pricing.lineItems) ? (pricing.lineItems as Array<Record<string, unknown>>) : [];
  const combined = buildCombinedAgreement(draft.resolved.document, {
    currency: typeof pricing.currency === "string" ? pricing.currency : "USD",
    lineItems: lines.map((line) => ({
      description: String(line.description ?? "Package"),
      quantity: Math.max(1, Number(line.quantity ?? 1)),
      totalCents: Number(line.totalCents ?? 0),
      kind: typeof line.kind === "string" ? line.kind : undefined,
      details: detailsForLine(proposal.get("packageDetails"), line.description),
    })),
    discountCents: Number(pricing.discountCents ?? 0),
    taxCents: Number(pricing.taxCents ?? 0),
    totalCents: Number(pricing.totalCents ?? 0),
    paymentSchedule: schedule.map((row) => ({
      label: String(row.label ?? "Payment"),
      amountCents: Number(row.amountCents ?? 0),
      dueDate: typeof row.dueDate === "string" && row.dueDate ? row.dueDate : null,
    })),
    salesTax: readPricedSalesTax(pricing.salesTax),
  }, trade);
  const document: ContractDocument = contractDocumentSchema.parse(combined.document);
  const sections: SectionWithHash[] = combined.sections.map((section) => ({
    ...section,
    hash: contractDocumentHash(sectionDocument(document, section)),
  }));
  return {
    project,
    proposal,
    draft,
    trade,
    document,
    documentHash: contractDocumentHash(document),
    sections,
  };
}

/** What the studio reads and signs before it sends. Writes nothing. */
export async function previewCombinedAgreement(
  context: CommandContext,
  input: z.infer<typeof combinedAgreementInput>,
) {
  if (!["studio_owner", "studio_admin", "studio_coordinator"].includes(String(context.membership.role)))
    throw new Error("FORBIDDEN");
  const db = getFirestore();
  const [resolved, depositOnline] = await Promise.all([
    resolveCombined(db, context, input),
    depositRaisedOnSigning(db, context.tenantId, input.projectId),
  ]);
  return {
    document: resolved.document,
    documentHash: resolved.documentHash,
    sections: resolved.sections,
    unresolved: resolved.draft.resolved.unresolved,
    clientEmail: resolved.draft.clientEmail,
    clientName: resolved.draft.clientName,
    templateVersion: resolved.draft.template.version,
    depositOnline,
  };
}

/**
 * Whether the client's signature raises the deposit invoice — the same
 * answer the send records in the plan: an active plan's own policy, or
 * whether QuickBooks or Stripe is connected. Without one the studio takes the
 * deposit itself, and the send dialog says so before it goes (Riley Park,
 * Spin Theory DJs, 2026-10-09).
 */
async function depositRaisedOnSigning(db: Firestore, tenantId: string, projectId: string): Promise<boolean> {
  const plan = await db.doc(`bookingOrchestrations/${projectId}`).get();
  if (plan.exists && plan.get("tenantId") === tenantId && plan.get("status") === "active")
    return plan.get("policy.createRetainerAfterSignature") === true;
  try {
    await requireProviderForTenant(db, tenantId, "invoicing");
    return true;
  } catch {
    return false;
  }
}

/** The owner signs both parts for the studio and sends the agreement. */
export async function sendCombinedAgreement(
  context: CommandContext,
  input: z.infer<typeof sendCombinedAgreementInput>,
) {
  requireOwnerOrAdmin(context.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED");
  const db = getFirestore();
  const resolved = await resolveCombined(db, context, input);
  if (resolved.documentHash !== input.documentHash) throw new Error("CONTRACT_CHANGED");
  if (resolved.draft.resolved.unresolved.length) throw new Error("CONTRACT_FIELDS_MISSING");
  const clientEmail = resolved.draft.clientEmail;
  if (!clientEmail) throw new Error("CLIENT_EMAIL_REQUIRED");
  let invoicingConnected = false;
  try {
    await requireProviderForTenant(db, context.tenantId, "invoicing");
    invoicingConnected = true;
  } catch {
    invoicingConnected = false;
  }
  const contractId = stableId("contract_sc", context.tenantId, context.idempotencyKey);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const contractPath = "/client/contract";
  const proposalStatusAtRead = String(resolved.proposal.get("status"));

  return db.runTransaction(async (transaction) => {
    const projectReference = db.doc(`projects/${input.projectId}`);
    const proposalReference = db.doc(`proposals/${input.proposalId}`);
    const orchestrationReference = db.doc(`bookingOrchestrations/${input.projectId}`);
    const executionReference = db.doc(`commandExecutions/${contractId}`);
    const [execution, project, proposal, contracts, versions, orchestration] = await Promise.all([
      transaction.get(executionReference),
      transaction.get(projectReference),
      transaction.get(proposalReference),
      transaction.get(
        db
          .collection("contracts")
          .where("tenantId", "==", context.tenantId)
          .where("projectId", "==", input.projectId)
          .limit(25),
      ),
      transaction.get(
        db
          .collection("proposals")
          .where("tenantId", "==", context.tenantId)
          .where("projectId", "==", input.projectId),
      ),
      transaction.get(orchestrationReference),
    ]);
    if (execution.exists) return execution.get("result") as Record<string, unknown>;
    if (!project.exists || !PROJECT_STATES.has(String(project.get("state")))) throw new Error("PROJECT_NOT_READY_FOR_PROPOSAL");
    // Unchanged since it was read: a proposal revised or sent in between is
    // not the one the studio signed.
    if (String(proposal.get("status")) !== proposalStatusAtRead) throw new Error("CONTRACT_CHANGED");
    if (contracts.docs.some((contract) => !DEAD_CONTRACT_STATUSES.has(String(contract.get("status")))))
      throw new Error("CONTRACT_ALREADY_EXISTS");
    const clientContactId = Array.isArray(project.get("clientContactIds"))
      ? String((project.get("clientContactIds") as unknown[])[0] ?? "")
      : "";
    const clientContact = clientContactId ? await transaction.get(db.doc(`contacts/${clientContactId}`)) : null;
    const invitation =
      !clientContact?.get("portalUserId") && clientContactId
        ? mintClientInvitation({
            tenantId: context.tenantId,
            projectId: input.projectId,
            email: clientEmail,
            appUrl,
            next: contractPath,
          })
        : null;
    const emailJobId = `contract_ready_${contractId}`;
    // Each partner on the job gets their own copy and link when anyone's is
    // an invitation (client/partner-invitations.ts).
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

    // --- writes ---
    const studioSignatures = resolved.sections.map((section) => {
      const id = `${contractId}_studio_${section.key}`;
      transaction.create(db.doc(`contractSignatures/${id}`), {
        id,
        tenantId: context.tenantId,
        projectId: input.projectId,
        contractId,
        role: "studio",
        section: section.key,
        sectionTitle: section.title,
        sectionHash: section.hash,
        // Over the whole agreement too: neither part can be swapped out.
        documentHash: input.documentHash,
        signerUid: context.actorId,
        signerEmail: context.actorEmail,
        typedName: input.studioSignerName,
        consentVersion: STUDIO_SIGNING_CONSENT_VERSION,
        consentTextHash: sha256Text(STUDIO_SIGNING_STATEMENT),
        authMethod: context.authMethod,
        emailVerified: context.emailVerified,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        signedAt: context.timestamp,
        createdAt: context.timestamp,
      });
      return { id, role: "studio", section: section.key, typedName: input.studioSignerName, signedAt: context.timestamp };
    });
    transaction.create(db.doc(`contracts/${contractId}`), {
      id: contractId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      proposalId: input.proposalId,
      mode: "combined",
      sections: resolved.sections,
      status: "sent",
      provider: "studiocue",
      providerEnvelopeId: null,
      providerState: "not_applicable",
      templateId: resolved.draft.template.templateId,
      templateVersionId: resolved.draft.template.versionId,
      document: resolved.document,
      documentHash: input.documentHash,
      unresolvedFields: [],
      mergeOverrides: input.overrides,
      signers: [
        {
          name: input.studioSignerName,
          email: context.actorEmail,
          role: "studio",
          order: 1,
          status: "completed",
          signedAt: context.timestamp,
        },
        {
          name: resolved.draft.clientName || "Client",
          email: clientEmail,
          role: "primary_client",
          order: 2,
          status: "sent",
          signedAt: null,
        },
      ],
      signatures: studioSignatures,
      sentAt: context.timestamp,
      viewedAt: null,
      completedAt: null,
      signedDocumentId: null,
      certificateDocumentId: null,
      completionEvidence: null,
      fileHash: null,
      lastProviderEventId: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      remindersSent: 0,
      lastReminderAt: null,
      createdAt: context.timestamp,
      updatedAt: context.timestamp,
      createdBy: context.actorId,
      updatedBy: context.actorId,
      archivedAt: null,
    });
    // The proposal goes out inside the agreement, not in an email of its own.
    for (const version of versions.docs) {
      if (version.id !== proposal.id && ["sent", "viewed", "declined", "expired"].includes(String(version.get("status")))) {
        transaction.update(version.ref, { status: "superseded", updatedAt: context.timestamp, updatedBy: context.actorId });
      }
    }
    transaction.update(proposalReference, {
      status: "sent",
      sentAt: proposal.get("sentAt") ?? context.timestamp,
      // The same validity window a proposal sent on its own gets.
      expiresAt: expiryOnSend(proposal.get("expiresAt"), new Date(context.timestamp)),
      combinedContractId: contractId,
      // The proposal's delivery line tracks the agreement's email: it went
      // out inside it (walked 2026-09-29: the page said "Not sent").
      emailJobId: `contract_ready_${contractId}`,
      emailDeliveryStatus: "queued",
      updatedAt: context.timestamp,
      updatedBy: context.actorId,
    });
    transaction.update(projectReference, {
      ...(project.get("state") === "CONSULTATION"
        ? { state: "PROPOSAL", stateVersion: Number(project.get("stateVersion") ?? 0) + 1 }
        : {}),
      // A vendor's client signs and pays the deposit in the same visit.
      nextAction: tradeProfile(resolved.trade).journey.oneLinkBooking
        ? "Waiting for the client to sign the booking link and pay the deposit"
        : "Waiting for the couple to review and sign the booking agreement",
      updatedAt: context.timestamp,
      updatedBy: context.actorId,
    });
    if (orchestration.exists && orchestration.get("status") === "active") {
      transaction.update(orchestrationReference, {
        contractId,
        proposalId: input.proposalId,
        currentStep: "wait_for_signature",
        updatedAt: context.timestamp,
      });
    } else if (!orchestration.exists || orchestration.get("status") !== "completed") {
      transaction.set(orchestrationReference, {
        id: input.projectId,
        tenantId: context.tenantId,
        projectId: input.projectId,
        proposalId: input.proposalId,
        contractId,
        invoiceId: null,
        status: "active",
        currentStep: "wait_for_signature",
        policy: {
          createRetainerAfterSignature: invoicingConnected,
          completeBookingAfterPayment: true,
          retainerDueDays: 7,
        },
        approvedBy: context.actorId,
        approvedAt: context.timestamp,
        lastError: null,
        completedAt: null,
        createdAt: context.timestamp,
        updatedAt: context.timestamp,
      });
    }
    const readyEmail = {
      id: emailJobId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      contractId,
      // The email worker marks the proposal sent (or failed) from this —
      // this one only; the partners' copies leave it off.
      proposalId: input.proposalId,
      type: "contract_ready",
      combined: true,
      recipient: clientEmail,
      recipientName: resolved.draft.clientName,
      actionUrl: invitation ? invitation.inviteUrl : `${appUrl}${contractPath}`,
      signerName: input.studioSignerName,
      // Whether signing raises the deposit invoice (the plan's policy), so
      // the email never promises "pay on the next screen" to the client of a
      // studio that takes the deposit itself (Riley Park, 2026-10-09).
      payOnline:
        orchestration.exists && orchestration.get("status") === "active"
          ? orchestration.get("policy.createRetainerAfterSignature") === true
          : invoicingConnected,
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
          acceptedAt: null,
          acceptedBy: null,
          revokedAt: null,
          lastSentAt: context.timestamp,
          latestEmailJobId: emailJobId,
          sendCount: 1,
          createdAt: context.timestamp,
          updatedAt: context.timestamp,
          createdBy: context.actorId,
          updatedBy: context.actorId,
          archivedAt: null,
        },
        { merge: true },
      );
    }
    const auditId = stableId("audit_combined_sent", context.tenantId, context.idempotencyKey);
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      actorType: "user",
      action: "contract.combined_studio_signed_and_sent",
      entityType: "contract",
      entityId: contractId,
      timestamp: context.timestamp,
      before: { proposalStatus: proposalStatusAtRead },
      after: {
        status: "sent",
        proposalId: input.proposalId,
        documentHash: input.documentHash,
        sections: resolved.sections.map((section) => ({ key: section.key, hash: section.hash })),
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    const output = { contractId, status: "sent", proposalId: input.proposalId, emailJobId };
    transaction.create(executionReference, {
      id: contractId,
      tenantId: context.tenantId,
      type: "send_combined_agreement",
      result: output,
      createdAt: context.timestamp,
    });
    return output;
  });
}
