import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import {
  canClientSignContract,
  normaliseEmail,
  normaliseTypedName,
  type SigningRefusal,
} from "@/features/contracts/signing-policy";
import {
  currentEsignConsent,
  esignConsentText,
  esignConsentVersion,
} from "@/features/contracts/esign-consent";
import { contractDocumentSchema } from "@/features/contracts/document";
import { contractDocumentHash, sha256Text } from "@/server/contracts/document-hash";

/**
 * The couple's side of a StudioCue contract: opening it, and signing it.
 *
 * Runs in the client portal route, with the signer's own verified session,
 * because that is where the evidence is: who they are (their Firebase
 * identity and portal membership), where they signed from (the request's
 * address and browser), and what they were shown (the hash the page sends
 * back). ADR 0006 sets out why this is signer evidence rather than the
 * studio's word, and the conditions that keep it so — enforced here and in
 * features/contracts/signing-policy.ts.
 *
 * Signing completes the contract and advances the job in one transaction, the
 * same two writes a signing vendor's verified webhook makes, so the booking
 * chain downstream (bookingContractCompleted → retainer → gate) runs
 * unchanged. The signed PDF is queued, not awaited.
 */

export class SigningRefused extends Error {
  constructor(readonly refusal: SigningRefusal) {
    super(refusal);
  }
}

export type SignerIdentity = {
  uid: string;
  email: string | null;
  emailVerified: boolean | null;
  authMethod: string | null;
};

export type RequestEvidence = {
  ipAddress: string | null;
  userAgent: string | null;
};

function stableId(scope: string, ...parts: string[]): string {
  return `${scope}_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;
}

function clientSignerOf(signers: unknown): Record<string, unknown> | null {
  if (!Array.isArray(signers)) return null;
  return (
    (signers as Array<Record<string, unknown>>).find(
      (signer) => signer?.role === "primary_client",
    ) ?? null
  );
}

/** First open of a sent contract by the person it is addressed to. */
export async function viewContract(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    contractId: string;
    signer: SignerIdentity;
    evidence: RequestEvidence;
  },
) {
  const reference = db.doc(`contracts/${input.contractId}`);
  return db.runTransaction(async (transaction) => {
    const contract = await transaction.get(reference);
    if (
      !contract.exists ||
      contract.get("tenantId") !== input.tenantId ||
      contract.get("projectId") !== input.projectId ||
      contract.get("provider") !== "studiocue"
    )
      return { viewed: false };
    if (contract.get("status") !== "sent") return { viewed: false };
    const signer = clientSignerOf(contract.get("signers"));
    if (normaliseEmail(signer?.email) !== normaliseEmail(input.signer.email))
      return { viewed: false };
    const now = new Date().toISOString();
    transaction.update(reference, {
      status: "viewed",
      viewedAt: now,
      updatedAt: now,
      updatedBy: input.signer.uid,
    });
    const auditId = stableId("audit_contract_viewed", input.tenantId, contract.id);
    transaction.set(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorId: input.signer.uid,
      actorType: "client",
      action: "contract.viewed",
      entityType: "contract",
      entityId: contract.id,
      timestamp: now,
      before: { status: "sent" },
      after: { status: "viewed" },
      ipAddress: input.evidence.ipAddress,
      userAgent: input.evidence.userAgent,
      correlationId: auditId,
      automationRunId: null,
      providerEventId: null,
    });
    return { viewed: true };
  });
}

/** Where the studio's own alerts go. The Next-side twin of functions/src/communications/notify-address.ts. */
export async function studioNotificationAddress(
  db: Firestore,
  auth: Auth,
  tenantId: string,
): Promise<string | null> {
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  const branding = tenant.get("emailBranding") as Record<string, unknown> | undefined;
  const configured = [branding?.replyTo, tenant.get("contactEmail"), tenant.get("email")].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (configured) return configured.trim();
  const memberships = await db
    .collection("memberships")
    .where("tenantId", "==", tenantId)
    .limit(50)
    .get();
  for (const owner of memberships.docs.filter(
    (document) =>
      document.get("role") === "studio_owner" && document.get("status") === "active",
  )) {
    try {
      const user = await auth.getUser(String(owner.get("userId") ?? ""));
      if (user.email) return user.email;
    } catch {
      // A membership pointing at a deleted user is no reason to stop looking.
    }
  }
  return null;
}

export async function signContract(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    contractId: string;
    documentHash: string;
    typedName: string;
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
  // Only the current wording may be agreed to. An old page open in a tab is
  // told to reload rather than sign under text that is no longer offered.
  if (!consent || consent.id !== currentEsignConsent.id)
    throw new SigningRefused("CONSENT_REQUIRED");
  const executionId = stableId(
    "client_sign",
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
  const signatureId = `${input.contractId}_client`;
  const signatureReference = db.doc(`contractSignatures/${signatureId}`);

  return db.runTransaction(async (transaction) => {
    const [execution, contract, project, membership, plan, existingSignature] =
      await Promise.all([
        transaction.get(executionReference),
        transaction.get(contractReference),
        transaction.get(projectReference),
        transaction.get(membershipReference),
        transaction.get(planReference),
        transaction.get(signatureReference),
      ]);
    if (execution.exists) return execution.get("result") as Record<string, unknown>;
    // A second tap on Sign, with a fresh key, after the first went through.
    if (
      existingSignature.exists &&
      existingSignature.get("signerUid") === input.signer.uid &&
      contract.get("status") === "completed"
    ) {
      return {
        contractId: input.contractId,
        status: "completed",
        projectState: String(project.get("state") ?? ""),
        alreadySigned: true,
      };
    }
    const sameProject =
      contract.exists &&
      contract.get("tenantId") === input.tenantId &&
      contract.get("projectId") === input.projectId;
    const clientSigner = clientSignerOf(contract.get("signers"));
    const decision = canClientSignContract({
      contract: {
        exists: sameProject,
        provider: contract.get("provider"),
        status: contract.get("status"),
        documentHash: contract.get("documentHash"),
        clientSignerEmail: clientSigner?.email,
      },
      projectState:
        project.exists && project.get("tenantId") === input.tenantId
          ? project.get("state")
          : null,
      signer: {
        membershipRole:
          membership.exists && membership.get("status") === "active"
            ? membership.get("role")
            : null,
        email: input.signer.email,
      },
      presentedDocumentHash: input.documentHash,
      consent: input.consent,
      typedName: input.typedName,
    });
    if (!decision.allowed) throw new SigningRefused(decision.refusal);
    // The stored text must still be the text both parties are signing. If the
    // record was altered after the studio signed, nobody signs it.
    const document = contractDocumentSchema.parse(contract.get("document"));
    if (contractDocumentHash(document) !== contract.get("documentHash"))
      throw new SigningRefused("DOCUMENT_CHANGED");

    const typedName = normaliseTypedName(input.typedName)!;
    const now = new Date().toISOString();
    const priorStateVersion = Number(project.get("stateVersion") ?? 0);
    const consentTextHash = sha256Text(esignConsentText(consent));

    transaction.create(signatureReference, {
      id: signatureId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      contractId: input.contractId,
      role: "client",
      signerUid: input.signer.uid,
      signerEmail: normaliseEmail(input.signer.email),
      typedName,
      documentHash: input.documentHash,
      consentVersion: consent.id,
      consentTextHash,
      authMethod: input.signer.authMethod,
      emailVerified: input.signer.emailVerified,
      ipAddress: input.evidence.ipAddress,
      userAgent: input.evidence.userAgent,
      signedAt: now,
      createdAt: now,
    });
    const signers = (contract.get("signers") as Array<Record<string, unknown>>).map((signer) =>
      signer.role === "primary_client"
        ? { ...signer, status: "completed", signedAt: now }
        : signer,
    );
    const signatures = [
      ...((contract.get("signatures") as unknown[] | undefined) ?? []),
      { id: signatureId, role: "client", typedName, signedAt: now },
    ];
    transaction.update(contractReference, {
      status: "completed",
      completedAt: now,
      // The couple's own act — not in studioVouchedAuthorities, so the gate
      // reads it as signer evidence (ADR 0006).
      completionAuthority: "client_signed",
      completionEvidence: {
        kind: "studiocue_signature",
        signatureId,
        documentHash: input.documentHash,
        signerEmail: normaliseEmail(input.signer.email),
        typedName,
        consentVersion: consent.id,
        signedAt: now,
      },
      signers,
      signatures,
      updatedAt: now,
      updatedBy: input.signer.uid,
    });
    transaction.update(projectReference, {
      state: "RETAINER_PENDING",
      stateVersion: priorStateVersion + 1,
      nextAction: "Collect the retainer",
      updatedAt: now,
      updatedBy: input.signer.uid,
    });
    // With no accounting app to raise the retainer, the plan's next wait is
    // the payment the studio records. With one, bookingContractCompleted
    // raises it and moves the plan itself.
    const retainerAutomatic =
      plan.exists &&
      plan.get("status") === "active" &&
      plan.get("contractId") === input.contractId &&
      plan.get("policy.createRetainerAfterSignature") === true;
    if (
      plan.exists &&
      plan.get("status") === "active" &&
      plan.get("contractId") === input.contractId &&
      !retainerAutomatic
    ) {
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
    transaction.create(db.doc(`auditEvents/${executionId}_signed`), {
      id: `${executionId}_signed`,
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorId: input.signer.uid,
      actorType: "client",
      action: "contract.signed_by_client",
      entityType: "contract",
      entityId: input.contractId,
      timestamp: now,
      before: { status: contract.get("status") },
      after: {
        status: "completed",
        signatureId,
        documentHash: input.documentHash,
        typedName,
        consentVersion: consent.id,
      },
      ipAddress: input.evidence.ipAddress,
      userAgent: input.evidence.userAgent,
      correlationId: executionId,
      automationRunId: null,
      providerEventId: null,
    });
    transaction.create(db.doc(`auditEvents/${executionId}_state`), {
      id: `${executionId}_state`,
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorId: input.signer.uid,
      actorType: "client",
      action: "project_state_changed",
      entityType: "project",
      entityId: input.projectId,
      timestamp: now,
      before: { state: "CONTRACT_PENDING", stateVersion: priorStateVersion },
      after: {
        state: "RETAINER_PENDING",
        stateVersion: priorStateVersion + 1,
        reason: "Agreement signed by the client in StudioCue",
      },
      ipAddress: input.evidence.ipAddress,
      userAgent: input.evidence.userAgent,
      correlationId: executionId,
      automationRunId: null,
      providerEventId: null,
    });
    if (input.studioAddress) {
      transaction.create(db.doc(`emailJobs/studio_contract_signed_${input.contractId}`), {
        id: `studio_contract_signed_${input.contractId}`,
        tenantId: input.tenantId,
        projectId: input.projectId,
        contractId: input.contractId,
        type: "studio_contract_signed",
        recipient: input.studioAddress,
        clientName: typedName,
        retainerAutomatic,
        actionUrl: `${input.appUrl.replace(/\/$/, "")}/studio/projects/${input.projectId}`,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    const result = {
      contractId: input.contractId,
      status: "completed",
      projectState: "RETAINER_PENDING",
      alreadySigned: false,
    };
    transaction.create(executionReference, {
      id: executionId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      type: "client_contract_signature",
      idempotencyKey: input.idempotencyKey,
      actorId: input.signer.uid,
      result,
      createdAt: now,
      completedAt: now,
    });
    return result;
  });
}
