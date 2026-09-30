import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { normaliseEmail, normaliseTypedName } from "@/features/contracts/signing-policy";
import { currentEsignConsent, esignConsentText, esignConsentVersion } from "@/features/contracts/esign-consent";
import { contractDocumentSchema } from "@/features/contracts/document";
import { contractDocumentHash, sha256Text } from "@/server/contracts/document-hash";
import { SigningRefused, type RequestEvidence, type SignerIdentity } from "@/server/contracts/client-signing";

/**
 * The couple signs a change to a booking they already signed.
 *
 * The evidence rules are the contract's (ADR 0006, client-signing.ts): their
 * own verified session, the text they were shown by hash, the current consent
 * wording, a typed name. What differs is the consequence: nothing here moves
 * the job's stage. Signing marks the amendment signed, and
 * functions/src/booking/amendment-apply.ts applies it — the same trigger the
 * studio's recorded signature runs through.
 */

function stableId(scope: string, ...parts: string[]): string {
  return `${scope}_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;
}

/**
 * What the couple sees of a change waiting for them. Never the studio's notes
 * on money it owes — nor the studio's reason for withdrawing one.
 *
 * A change the studio withdrew after sending is included, so the portal can
 * say so: it used to vanish from under a couple who had been emailed to sign
 * it. A draft they were never sent is not.
 */
export async function pendingAmendmentFor(db: Firestore, tenantId: string, projectId: string) {
  const found = await db
    .collection("bookingAmendments")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .where("status", "in", ["sent", "signed", "applied", "cancelled"])
    .limit(20)
    .get();
  const shown = found.docs.filter((doc) => doc.get("status") !== "cancelled" || Boolean(doc.get("sentAt")));
  const newest = shown.sort((a, b) =>
    String(b.get("sentAt") ?? b.get("updatedAt") ?? "").localeCompare(String(a.get("sentAt") ?? a.get("updatedAt") ?? "")),
  )[0];
  if (!newest || newest.get("signingMode") !== "studiocue") return null;
  const withdrawn = newest.get("status") === "cancelled";
  return {
    id: newest.id,
    status: String(newest.get("status")),
    withdrawnAt: withdrawn ? (newest.get("cancelledAt") ?? null) : null,
    changes: Array.isArray(newest.get("changes")) ? (newest.get("changes") as unknown[]).map(String) : [],
    // Nothing to read or sign in a withdrawn change.
    document: withdrawn ? null : (newest.get("document") ?? null),
    documentHash: withdrawn ? null : (newest.get("documentHash") ?? null),
    studioSignerName: String((newest.get("studioSignature") as Record<string, unknown> | null)?.typedName ?? ""),
    sentAt: newest.get("sentAt") ?? null,
    signedAt: newest.get("signedAt") ?? null,
  };
}

export async function signAmendment(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    amendmentId: string;
    documentHash: string;
    typedName: string;
    consent: boolean;
    consentVersion: string;
    idempotencyKey: string;
    signer: SignerIdentity;
    evidence: RequestEvidence;
  },
) {
  const consent = esignConsentVersion(input.consentVersion);
  if (!consent) throw new SigningRefused("CONSENT_REQUIRED");
  if (consent.id !== currentEsignConsent.id) throw new SigningRefused("CONSENT_OUTDATED");
  if (!input.consent) throw new SigningRefused("CONSENT_REQUIRED");
  const typedName = normaliseTypedName(input.typedName);
  if (!typedName) throw new SigningRefused("NAME_REQUIRED");
  const executionId = stableId("client_amendment_sign", input.signer.uid, input.tenantId, input.amendmentId, input.idempotencyKey);
  const executionReference = db.doc(`commandExecutions/${executionId}`);
  const amendmentReference = db.doc(`bookingAmendments/${input.amendmentId}`);
  const membershipReference = db.doc(`memberships/${input.tenantId}_${input.signer.uid}`);
  const signatureId = `${input.amendmentId}_client`;
  const signatureReference = db.doc(`contractSignatures/${signatureId}`);

  return db.runTransaction(async (transaction) => {
    const [execution, amendment, membership, existingSignature] = await Promise.all([
      transaction.get(executionReference),
      transaction.get(amendmentReference),
      transaction.get(membershipReference),
      transaction.get(signatureReference),
    ]);
    if (execution.exists) return execution.get("result") as Record<string, unknown>;
    if (
      !amendment.exists ||
      amendment.get("tenantId") !== input.tenantId ||
      amendment.get("projectId") !== input.projectId ||
      amendment.get("signingMode") !== "studiocue"
    )
      throw new SigningRefused("CONTRACT_NOT_FOUND");
    const status = String(amendment.get("status"));
    if (["signed", "applied"].includes(status)) {
      if (existingSignature.exists && existingSignature.get("signerUid") === input.signer.uid)
        return { amendmentId: input.amendmentId, status, alreadySigned: true };
      throw new SigningRefused("CONTRACT_ALREADY_SIGNED");
    }
    if (status === "cancelled") throw new SigningRefused("CHANGE_WITHDRAWN");
    if (status !== "sent") throw new SigningRefused("CONTRACT_NOT_SENT");
    const role = membership.exists && membership.get("status") === "active" ? membership.get("role") : null;
    if (role !== "client") throw new SigningRefused("SIGNER_NOT_A_CLIENT");
    if (normaliseEmail(amendment.get("clientEmail")) !== normaliseEmail(input.signer.email))
      throw new SigningRefused("WRONG_SIGNER");
    if (amendment.get("documentHash") !== input.documentHash) throw new SigningRefused("DOCUMENT_CHANGED");
    const document = contractDocumentSchema.parse(amendment.get("document"));
    if (contractDocumentHash(document) !== input.documentHash) throw new SigningRefused("DOCUMENT_CHANGED");

    const now = new Date().toISOString();
    transaction.create(signatureReference, {
      id: signatureId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      amendmentId: input.amendmentId,
      contractId: null,
      role: "client",
      signerUid: input.signer.uid,
      signerEmail: normaliseEmail(input.signer.email),
      typedName,
      documentHash: input.documentHash,
      consentVersion: consent.id,
      consentTextHash: sha256Text(esignConsentText(consent)),
      authMethod: input.signer.authMethod,
      emailVerified: input.signer.emailVerified,
      ipAddress: input.evidence.ipAddress,
      userAgent: input.evidence.userAgent,
      signedAt: now,
      createdAt: now,
    });
    transaction.update(amendmentReference, {
      status: "signed",
      signedAt: now,
      clientSignature: {
        id: signatureId,
        kind: "client_signed",
        typedName,
        signerUid: input.signer.uid,
        signerEmail: normaliseEmail(input.signer.email),
        consentVersion: consent.id,
      },
      updatedAt: now,
      updatedBy: input.signer.uid,
    });
    transaction.create(db.doc(`auditEvents/${executionId}_signed`), {
      id: `${executionId}_signed`,
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorId: input.signer.uid,
      actorType: "client",
      action: "booking.amendment_signed_by_client",
      entityType: "bookingAmendment",
      entityId: input.amendmentId,
      timestamp: now,
      before: { status: "sent" },
      after: { status: "signed", signatureId, documentHash: input.documentHash, typedName, consentVersion: consent.id },
      ipAddress: input.evidence.ipAddress,
      userAgent: input.evidence.userAgent,
      correlationId: executionId,
      automationRunId: null,
      providerEventId: null,
    });
    const result = { amendmentId: input.amendmentId, status: "signed", alreadySigned: false };
    transaction.create(executionReference, {
      id: executionId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      type: "client_amendment_signature",
      idempotencyKey: input.idempotencyKey,
      actorId: input.signer.uid,
      result,
      createdAt: now,
      completedAt: now,
    });
    return result;
  });
}
