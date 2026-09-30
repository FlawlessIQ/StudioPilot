import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  canClientSignContract,
  normaliseEmail,
  normaliseTypedName,
} from "@/features/contracts/signing-policy";
import {
  currentEsignConsent,
  esignConsentText,
  esignConsentVersion,
} from "@/features/contracts/esign-consent";
import { contractDocumentSchema } from "@/features/contracts/document";
import { sectionDocument, sectionsValid, type CombinedSection } from "@/features/contracts/combined";
import { planClientProposalDecision } from "@/server/client/proposal-decision";
import { contractDocumentHash, sha256Text } from "@/server/contracts/document-hash";
import { SigningRefused, type RequestEvidence, type SignerIdentity } from "@/server/contracts/client-signing";

/**
 * The couple signs the booking agreement: both parts, one sitting (H2 Part B,
 * docs/proposal-agreement-and-addons-plan-2026-09-28.md).
 *
 * Part 1 (the studio's terms) and Part 2 (the coverage and price) are each
 * signed with their own typed name, over their own hash, and both over the
 * hash of the whole. Both signatures or neither: signing the terms alone
 * saves nothing. The same transaction accepts the proposal and completes the
 * contract — the two evidence-controlled moves, PROPOSAL → CONTRACT_PENDING
 * (the proposal, accepted by the couple) and CONTRACT_PENDING →
 * RETAINER_PENDING (the contract, signed by the couple) — each recorded as
 * its own state change, so the booking chain downstream
 * (bookingContractCompleted → retainer → gate) runs exactly as after a
 * contract signed on its own.
 */

function stableId(scope: string, ...parts: string[]): string {
  return `${scope}_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;
}

export async function signCombinedAgreement(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    contractId: string;
    documentHash: string;
    /** Typed once under the terms, and once under the coverage. */
    typedNameTerms: string;
    typedNameCoverage: string;
    consent: boolean;
    consentVersion: string;
    idempotencyKey: string;
    signer: SignerIdentity;
    evidence: RequestEvidence;
    studioAddress: string | null;
    appUrl: string;
  },
) {
  const consent = esignConsentVersion(input.consentVersion);
  if (!consent) throw new SigningRefused("CONSENT_REQUIRED");
  if (consent.id !== currentEsignConsent.id) throw new SigningRefused("CONSENT_OUTDATED");
  const executionId = stableId(
    "client_sign_combined",
    input.signer.uid,
    input.tenantId,
    input.contractId,
    input.idempotencyKey,
  );
  const executionReference = db.doc(`commandExecutions/${executionId}`);
  const contractReference = db.doc(`contracts/${input.contractId}`);
  const projectReference = db.doc(`projects/${input.projectId}`);
  const membershipReference = db.doc(`memberships/${input.tenantId}_${input.signer.uid}`);
  const planReference = db.doc(`bookingOrchestrations/${input.projectId}`);

  return db.runTransaction(async (transaction) => {
    const [execution, contract, project, membership, plan] = await Promise.all([
      transaction.get(executionReference),
      transaction.get(contractReference),
      transaction.get(projectReference),
      transaction.get(membershipReference),
      transaction.get(planReference),
    ]);
    if (execution.exists) return execution.get("result") as Record<string, unknown>;
    if (
      !contract.exists ||
      contract.get("tenantId") !== input.tenantId ||
      contract.get("projectId") !== input.projectId ||
      contract.get("mode") !== "combined"
    )
      throw new SigningRefused("CONTRACT_NOT_FOUND");
    // A second tap after the first went through.
    if (contract.get("status") === "completed") {
      return { contractId: input.contractId, status: "completed", projectState: String(project.get("state") ?? ""), alreadySigned: true };
    }
    const proposalId = String(contract.get("proposalId") ?? "");
    const proposalReference = db.doc(`proposals/${proposalId}`);
    const [proposal, latest] = await Promise.all([
      transaction.get(proposalReference),
      transaction.get(
        db
          .collection("proposals")
          .where("tenantId", "==", input.tenantId)
          .where("projectId", "==", input.projectId)
          .orderBy("version", "desc")
          .limit(1),
      ),
    ]);
    if (!proposal.exists || proposal.get("tenantId") !== input.tenantId || proposal.get("projectId") !== input.projectId)
      throw new SigningRefused("CONTRACT_NOT_FOUND");
    // The agreement carries this proposal's price; a newer version means the
    // studio has changed it, and this agreement is no longer the deal.
    if (latest.docs[0]?.id !== proposalId) throw new SigningRefused("DOCUMENT_CHANGED");
    const projectState = project.exists && project.get("tenantId") === input.tenantId ? String(project.get("state")) : null;
    if (projectState !== "PROPOSAL") throw new SigningRefused("PROJECT_NOT_AWAITING_SIGNATURE");
    const packageSnapshotId = String(proposal.get("packageSnapshotId") ?? "");
    const now = new Date().toISOString();
    let acceptance;
    try {
      acceptance = planClientProposalDecision({
        decision: "accepted",
        now,
        project: {
          state: projectState,
          packageSnapshotId: (project.get("packageSnapshotId") as string | null) ?? null,
          additionalPackageSnapshotIds: idList(project.get("additionalPackageSnapshotIds")),
        },
        proposal: {
          status: String(proposal.get("status") ?? ""),
          expiresAt: String(proposal.get("expiresAt") ?? ""),
          packageSnapshotId,
          additionalPackageSnapshotIds: idList(proposal.get("additionalPackageSnapshotIds")),
        },
      });
    } catch (caught: unknown) {
      throw new SigningRefused(
        caught instanceof Error && caught.message === "PROPOSAL_EXPIRED" ? "PROPOSAL_EXPIRED" : "DOCUMENT_CHANGED",
      );
    }
    const clientSigner = (contract.get("signers") as Array<Record<string, unknown>>).find(
      (signer) => signer?.role === "primary_client",
    );
    // The same policy as any contract, judged as if the proposal were
    // already accepted — which, in this transaction, it is.
    const decision = canClientSignContract({
      contract: {
        exists: true,
        provider: contract.get("provider"),
        status: contract.get("status"),
        documentHash: contract.get("documentHash"),
        clientSignerEmail: clientSigner?.email,
      },
      projectState: "CONTRACT_PENDING",
      signer: {
        membershipRole: membership.exists && membership.get("status") === "active" ? membership.get("role") : null,
        email: input.signer.email,
      },
      presentedDocumentHash: input.documentHash,
      consent: input.consent,
      typedName: input.typedNameTerms,
    });
    if (!decision.allowed) throw new SigningRefused(decision.refusal);
    const typedNameTerms = normaliseTypedName(input.typedNameTerms);
    const typedNameCoverage = normaliseTypedName(input.typedNameCoverage);
    if (!typedNameTerms || !typedNameCoverage) throw new SigningRefused("NAME_REQUIRED");
    const document = contractDocumentSchema.parse(contract.get("document"));
    if (contractDocumentHash(document) !== contract.get("documentHash")) throw new SigningRefused("DOCUMENT_CHANGED");
    const sections = (contract.get("sections") ?? []) as Array<CombinedSection & { hash: string }>;
    if (
      !sectionsValid(document, sections) ||
      sections.some((section) => contractDocumentHash(sectionDocument(document, section)) !== section.hash)
    )
      throw new SigningRefused("DOCUMENT_CHANGED");

    const priorStateVersion = Number(project.get("stateVersion") ?? 0);
    const consentTextHash = sha256Text(esignConsentText(consent));
    const signerEmail = normaliseEmail(input.signer.email);
    const clientSignatures = sections.map((section) => {
      const id = `${input.contractId}_client_${section.key}`;
      const typedName = section.key === "terms" ? typedNameTerms : typedNameCoverage;
      transaction.create(db.doc(`contractSignatures/${id}`), {
        id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        contractId: input.contractId,
        role: "client",
        section: section.key,
        sectionTitle: section.title,
        sectionHash: section.hash,
        documentHash: input.documentHash,
        signerUid: input.signer.uid,
        signerEmail,
        typedName,
        consentVersion: consent.id,
        consentTextHash,
        authMethod: input.signer.authMethod,
        emailVerified: input.signer.emailVerified,
        ipAddress: input.evidence.ipAddress,
        userAgent: input.evidence.userAgent,
        signedAt: now,
        createdAt: now,
      });
      return { id, role: "client", section: section.key, typedName, signedAt: now };
    });
    const signers = (contract.get("signers") as Array<Record<string, unknown>>).map((signer) =>
      signer.role === "primary_client" ? { ...signer, status: "completed", signedAt: now } : signer,
    );
    transaction.update(contractReference, {
      status: "completed",
      completedAt: now,
      completionAuthority: "client_signed",
      completionEvidence: {
        kind: "studiocue_signature",
        signatureId: clientSignatures[clientSignatures.length - 1]!.id,
        signatureIds: clientSignatures.map((signature) => signature.id),
        documentHash: input.documentHash,
        signerEmail,
        typedName: typedNameCoverage,
        consentVersion: consent.id,
        signedAt: now,
      },
      signers,
      signatures: [...((contract.get("signatures") as unknown[] | undefined) ?? []), ...clientSignatures],
      updatedAt: now,
      updatedBy: input.signer.uid,
    });
    transaction.update(proposalReference, {
      status: acceptance.proposalStatus,
      acceptedAt: now,
      declinedAt: null,
      declineReason: null,
      decisionBy: input.signer.uid,
      acceptedWithContractId: input.contractId,
      updatedAt: now,
      updatedBy: input.signer.uid,
    });
    transaction.update(projectReference, {
      packageSnapshotId,
      state: "RETAINER_PENDING",
      stateVersion: priorStateVersion + 2,
      nextAction: "Collect the retainer",
      updatedAt: now,
      updatedBy: input.signer.uid,
    });
    const retainerAutomatic =
      plan.exists &&
      plan.get("status") === "active" &&
      plan.get("contractId") === input.contractId &&
      plan.get("policy.createRetainerAfterSignature") === true;
    if (plan.exists && plan.get("status") === "active" && plan.get("contractId") === input.contractId && !retainerAutomatic) {
      transaction.update(planReference, { currentStep: "wait_for_payment", updatedAt: now });
    }
    transaction.create(db.doc(`pdfJobs/contract_seal_${input.contractId}`), {
      id: `contract_seal_${input.contractId}`,
      tenantId: input.tenantId,
      projectId: input.projectId,
      contractId: input.contractId,
      type: "contract_pdf",
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    const audit = (suffix: string, fields: Record<string, unknown>) =>
      transaction.create(db.doc(`auditEvents/${executionId}_${suffix}`), {
        id: `${executionId}_${suffix}`,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.signer.uid,
        actorType: "client",
        timestamp: now,
        ipAddress: input.evidence.ipAddress,
        userAgent: input.evidence.userAgent,
        correlationId: executionId,
        automationRunId: null,
        providerEventId: null,
        ...fields,
      });
    audit("proposal", {
      action: "proposal_accepted",
      entityType: "proposal",
      entityId: proposalId,
      before: { status: proposal.get("status") },
      after: { status: "accepted", via: "combined_agreement", contractId: input.contractId },
    });
    audit("state_accepted", {
      action: "project_state_changed",
      entityType: "project",
      entityId: input.projectId,
      before: { state: "PROPOSAL", stateVersion: priorStateVersion },
      after: {
        state: "CONTRACT_PENDING",
        stateVersion: priorStateVersion + 1,
        reason: "Proposal accepted by the client in the booking agreement",
      },
    });
    audit("signed", {
      action: "contract.signed_by_client",
      entityType: "contract",
      entityId: input.contractId,
      before: { status: contract.get("status") },
      after: {
        status: "completed",
        signatureIds: clientSignatures.map((signature) => signature.id),
        documentHash: input.documentHash,
        sections: sections.map((section) => ({ key: section.key, hash: section.hash })),
        consentVersion: consent.id,
      },
    });
    audit("state_signed", {
      action: "project_state_changed",
      entityType: "project",
      entityId: input.projectId,
      before: { state: "CONTRACT_PENDING", stateVersion: priorStateVersion + 1 },
      after: {
        state: "RETAINER_PENDING",
        stateVersion: priorStateVersion + 2,
        reason: "Agreement signed by the client in StudioCue",
      },
    });
    if (input.studioAddress) {
      transaction.create(db.doc(`emailJobs/studio_contract_signed_${input.contractId}`), {
        id: `studio_contract_signed_${input.contractId}`,
        tenantId: input.tenantId,
        projectId: input.projectId,
        contractId: input.contractId,
        type: "studio_contract_signed",
        recipient: input.studioAddress,
        clientName: typedNameCoverage,
        retainerAutomatic,
        actionUrl: `${input.appUrl.replace(/\/$/, "")}/studio/projects/${input.projectId}`,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    const result = { contractId: input.contractId, status: "completed", projectState: "RETAINER_PENDING", alreadySigned: false };
    transaction.create(executionReference, {
      id: executionId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      type: "client_combined_agreement_signature",
      idempotencyKey: input.idempotencyKey,
      actorId: input.signer.uid,
      result,
      createdAt: now,
      completedAt: now,
    });
    return result;
  });
}

/** A stored id list, or none — for comparing every package, not just the main one. */
function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
