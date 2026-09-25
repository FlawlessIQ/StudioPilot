import { createHash } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { mintClientInvitation } from "../client/invitation-mint.js";
import { requireProviderForTenant } from "../integrations/capability-resolution.js";
import { productEvent } from "../operations/product-events.js";
import {
  contractDocumentSchema,
  convertImportedAgreement,
  customFieldKey,
  resolveContractDocument,
  templateFieldKeys,
  TEMPLATE_BODY_MAX,
  type ContractCustomField,
  type ContractDocument,
} from "./document.js";
import { contractDocumentHash, sha256Text } from "./document-hash.js";
import {
  customFieldsFrom,
  importedAgreementText,
  loadAgreementTemplate,
  loadContractSources,
} from "./sources.js";

/**
 * StudioCue's own contracts: the studio side.
 *
 * Dispatched from bookingCommand, so every command here inherits its App
 * Check, identity, membership, subscription and idempotency handling. The
 * couple's side — viewing and signing — runs in the client portal route
 * (app/api/client/portal/route.ts), where the signer's own session is.
 *
 * The flow:
 *
 *   saveAgreementTemplate   the studio's agreement, as an immutable version
 *   prepareContract         resolve it against the accepted proposal → draft
 *   sendContract            the owner signs for the studio and sends
 *   voidContract            withdraw a sent, unsigned contract
 *
 * A draft lives in `contractDrafts/{projectId}`, not in `contracts`. Every
 * reader of `contracts` treats a record there as something the couple has been
 * sent; a draft is not that, and keeping it out means none of them has to learn
 * the difference. The contract record is created at send.
 *
 * Nothing here marks a contract complete. Only the couple's signature does,
 * in the portal route (ADR 0006).
 */

/** Held off until counsel has reviewed the consent wording. See docs/contracts.md. */
export const NATIVE_SIGNING_GENERALLY_AVAILABLE = false;

/**
 * Must match STUDIO_SIGNING_STATEMENT in features/contracts/esign-consent.ts;
 * tests/contract-document.test.ts compares them.
 */
export const STUDIO_SIGNING_STATEMENT =
  "I'm signing this agreement for the studio, electronically, and my typed name is my signature.";
export const STUDIO_SIGNING_CONSENT_VERSION = "studio-signing-v1";

const DEAD_CONTRACT_STATUSES = new Set(["failed", "superseded", "voided"]);

export async function nativeSigningEnabled(
  db: Firestore,
  tenantId: string,
): Promise<boolean> {
  if (NATIVE_SIGNING_GENERALLY_AVAILABLE) return true;
  const features = await db.doc(`tenantFeatures/${tenantId}`).get();
  return features.exists && features.get("nativeContractSigning") === true;
}

async function requireNativeSigning(db: Firestore, tenantId: string) {
  if (!(await nativeSigningEnabled(db, tenantId)))
    throw new Error("NATIVE_SIGNING_NOT_ENABLED");
}

function requireOwnerOrAdmin(membership: Record<string, unknown>, error: string) {
  if (!["studio_owner", "studio_admin"].includes(String(membership.role)))
    throw new Error(error);
}

function stableId(scope: string, ...parts: string[]): string {
  return `${scope}_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;
}

const customFieldInput = z.object({
  key: z.string().regex(/^custom\.[a-z0-9_]+$/).max(80),
  label: z.string().trim().min(1).max(80),
});

export const saveAgreementTemplateInput = z.object({
  /** Null creates a new agreement; an id saves a new version of that one. */
  templateId: z.string().min(1).max(160).nullable(),
  name: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(200),
  body: z.string().min(50).max(TEMPLATE_BODY_MAX),
  customFields: z.array(customFieldInput).max(40).default([]),
  makeDefault: z.boolean().default(true),
});

export const agreementDraftFromImportInput = z.object({
  templateId: z.string().min(1).max(160),
});

export const prepareContractInput = z.object({
  projectId: z.string().min(1),
  proposalId: z.string().min(1),
  /** Values for fields the records cannot answer. Money and dates are never taken from here. */
  overrides: z.record(z.string().max(80), z.string().max(500)).default({}),
});

export const sendContractInput = z.object({
  projectId: z.string().min(1),
  /** The hash of the draft the studio reviewed. A change since then refuses the send. */
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  studioSignerName: z.string().trim().min(2).max(160),
  consent: z.literal(true),
});

export const voidContractInput = z.object({
  projectId: z.string().min(1),
  contractId: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
});

type CommandContext = {
  tenantId: string;
  membership: Record<string, unknown>;
  actorId: string;
  actorEmail: string | null;
  authMethod: string | null;
  emailVerified: boolean | null;
  timestamp: string;
  idempotencyKey: string;
  ipAddress: string | null;
  userAgent: string | null;
};

// ---------------------------------------------------------------------------
// The agreement template
// ---------------------------------------------------------------------------

/**
 * A draft template from an agreement the studio imported. Writes nothing: the
 * studio reads it in the editor, changes what it wants, and saves.
 */
export async function agreementDraftFromImport(
  context: CommandContext,
  input: z.infer<typeof agreementDraftFromImportInput>,
) {
  requireOwnerOrAdmin(context.membership, "AGREEMENT_PERMISSION_REQUIRED");
  const db = getFirestore();
  await requireNativeSigning(db, context.tenantId);
  const head = await db.doc(`agreementTemplates/${input.templateId}`).get();
  if (!head.exists || head.get("tenantId") !== context.tenantId)
    throw new Error("AGREEMENT_TEMPLATE_NOT_FOUND");
  const text = importedAgreementText(head.get("body"));
  if (!text.trim()) throw new Error("IMPORTED_AGREEMENT_EMPTY");
  const conversion = convertImportedAgreement(text);
  return {
    templateId: head.id,
    name: String(head.get("name") ?? "Agreement"),
    ...conversion,
  };
}

export async function saveAgreementTemplate(
  context: CommandContext,
  input: z.infer<typeof saveAgreementTemplateInput>,
) {
  requireOwnerOrAdmin(context.membership, "AGREEMENT_PERMISSION_REQUIRED");
  const db = getFirestore();
  await requireNativeSigning(db, context.tenantId);
  // The starter agreement's scaffolding says "[Replace with …]". Saving it
  // unreplaced would put that sentence in front of a couple as a term.
  if (/\[Replace with/i.test(input.body)) throw new Error("AGREEMENT_HAS_PLACEHOLDER_TEXT");
  // Every custom token in the body needs a label, so the studio is asked for a
  // named thing ("Second location") rather than a key. One the editor did not
  // send gets a label from its own name.
  const declared = new Map(input.customFields.map((field) => [field.key, field]));
  const customFields: ContractCustomField[] = templateFieldKeys(input.body)
    .filter((key) => key.startsWith("custom."))
    .map(
      (key) =>
        declared.get(key) ?? {
          key,
          label: key.replace(/^custom\./, "").replace(/_/g, " "),
        },
    );
  const templateId =
    input.templateId ?? stableId("agreement", context.tenantId, context.idempotencyKey);
  const headReference = db.doc(`agreementTemplates/${templateId}`);
  const tenantReference = db.doc(`tenants/${context.tenantId}`);
  const result = await db.runTransaction(async (transaction) => {
    const [head, tenant] = await Promise.all([
      transaction.get(headReference),
      transaction.get(tenantReference),
    ]);
    if (input.templateId && (!head.exists || head.get("tenantId") !== context.tenantId))
      throw new Error("AGREEMENT_TEMPLATE_NOT_FOUND");
    if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");
    const version = Number(head.get("latestVersion") ?? 0) + 1;
    const versionId = `${templateId}_v${version}`;
    transaction.create(db.doc(`agreementTemplateVersions/${versionId}`), {
      id: versionId,
      tenantId: context.tenantId,
      templateId,
      version,
      title: input.title,
      body: input.body,
      bodyHash: sha256Text(input.body),
      customFields,
      createdAt: context.timestamp,
      createdBy: context.actorId,
    });
    transaction.set(
      headReference,
      {
        id: templateId,
        tenantId: context.tenantId,
        name: input.name,
        status: "active",
        currentVersionId: versionId,
        latestVersion: version,
        // An imported agreement keeps its source fields; this only says the
        // studio has now made it theirs.
        source: head.exists ? (head.get("source") ?? "imported") : "written",
        reviewedAt: context.timestamp,
        reviewedBy: context.actorId,
        ...(head.exists
          ? {}
          : { createdAt: context.timestamp, createdBy: context.actorId, archivedAt: null }),
        updatedAt: context.timestamp,
        updatedBy: context.actorId,
      },
      { merge: true },
    );
    const settings = (tenant.get("defaultContractSettings") ?? {}) as Record<string, unknown>;
    const becomesDefault =
      input.makeDefault || typeof settings.agreementTemplateId !== "string";
    if (becomesDefault) {
      transaction.update(tenantReference, {
        "defaultContractSettings.agreementTemplateId": templateId,
        updatedAt: context.timestamp,
        updatedBy: context.actorId,
      });
    }
    const auditId = stableId("audit_agreement", context.tenantId, context.idempotencyKey);
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: context.tenantId,
      projectId: null,
      actorId: context.actorId,
      actorType: "user",
      action: "agreement_template.version_saved",
      entityType: "agreementTemplate",
      entityId: templateId,
      timestamp: context.timestamp,
      before: head.exists ? { version: version - 1 } : null,
      after: { version, versionId, becameDefault: becomesDefault },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    return { templateId, versionId, version, isDefault: becomesDefault };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

async function requireContractableProject(
  db: Firestore,
  tenantId: string,
  projectId: string,
  proposalId: string,
) {
  const [project, proposal, contracts] = await Promise.all([
    db.doc(`projects/${projectId}`).get(),
    db.doc(`proposals/${proposalId}`).get(),
    db
      .collection("contracts")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .limit(25)
      .get(),
  ]);
  if (
    !project.exists ||
    project.get("tenantId") !== tenantId ||
    project.get("state") !== "CONTRACT_PENDING"
  )
    throw new Error("CONTRACT_NOT_READY");
  if (
    !proposal.exists ||
    proposal.get("tenantId") !== tenantId ||
    proposal.get("projectId") !== projectId ||
    proposal.get("status") !== "accepted"
  )
    throw new Error("ACCEPTED_PROPOSAL_REQUIRED");
  if (contracts.docs.some((contract) => contract.get("status") === "completed"))
    throw new Error("CONTRACT_ALREADY_COMPLETED");
  if (
    contracts.docs.some(
      (contract) => !DEAD_CONTRACT_STATUSES.has(String(contract.get("status"))),
    )
  )
    throw new Error("CONTRACT_ALREADY_EXISTS");
  return { project, proposal };
}

/** Resolve a draft from records. Shared by prepare, send's recheck, and the acceptance trigger. */
export async function resolveDraft(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    proposalId: string;
    templateVersionId?: string | null;
    overrides: Record<string, string>;
    today: string;
  },
) {
  let template;
  if (input.templateVersionId) {
    const version = await db.doc(`agreementTemplateVersions/${input.templateVersionId}`).get();
    if (!version.exists || version.get("tenantId") !== input.tenantId)
      throw new Error("AGREEMENT_TEMPLATE_REQUIRED");
    template = {
      templateId: String(version.get("templateId")),
      versionId: version.id,
      version: Number(version.get("version") ?? 1),
      template: {
        title: String(version.get("title") ?? "Agreement"),
        body: String(version.get("body") ?? ""),
        customFields: customFieldsFrom(version.get("customFields")),
      },
    };
  } else {
    template = await loadAgreementTemplate(db, input.tenantId);
  }
  if (!template) throw new Error("AGREEMENT_TEMPLATE_REQUIRED");
  const loaded = await loadContractSources(db, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    proposalId: input.proposalId,
    today: input.today,
  });
  const resolved = resolveContractDocument({
    template: template.template,
    sources: loaded.sources,
    overrides: input.overrides,
  });
  return {
    template,
    clientEmail: loaded.clientEmail,
    clientName: loaded.clientName,
    resolved,
    documentHash: contractDocumentHash(resolved.document),
  };
}

export async function prepareContract(
  context: CommandContext,
  input: z.infer<typeof prepareContractInput>,
) {
  if (
    !["studio_owner", "studio_admin", "studio_coordinator"].includes(
      String(context.membership.role),
    )
  )
    throw new Error("FORBIDDEN");
  const db = getFirestore();
  await requireNativeSigning(db, context.tenantId);
  await requireContractableProject(db, context.tenantId, input.projectId, input.proposalId);
  const draftReference = db.doc(`contractDrafts/${input.projectId}`);
  const existing = await draftReference.get();
  if (existing.exists && existing.get("tenantId") !== context.tenantId)
    throw new Error("FORBIDDEN");
  // A draft is prepared on the day it is prepared; resending later keeps it.
  const today = context.timestamp.slice(0, 10);
  const draft = await resolveDraft(db, {
    tenantId: context.tenantId,
    projectId: input.projectId,
    proposalId: input.proposalId,
    // Re-preparing always takes the studio's current agreement.
    templateVersionId: null,
    overrides: input.overrides,
    today,
  });
  await draftReference.set({
    id: input.projectId,
    tenantId: context.tenantId,
    projectId: input.projectId,
    proposalId: input.proposalId,
    templateId: draft.template.templateId,
    templateVersionId: draft.template.versionId,
    templateVersion: draft.template.version,
    document: draft.resolved.document,
    documentHash: draft.documentHash,
    status: "draft",
    sentContractId: null,
    fields: draft.resolved.fields,
    unresolvedFields: draft.resolved.unresolved,
    mergeOverrides: input.overrides,
    preparedOn: today,
    clientName: draft.clientName,
    clientEmail: draft.clientEmail,
    source: "studio",
    createdAt: existing.exists ? existing.get("createdAt") : context.timestamp,
    createdBy: existing.exists ? existing.get("createdBy") : context.actorId,
    updatedAt: context.timestamp,
    updatedBy: context.actorId,
  });
  return {
    projectId: input.projectId,
    documentHash: draft.documentHash,
    unresolved: draft.resolved.unresolved,
    templateVersion: draft.template.version,
  };
}

// ---------------------------------------------------------------------------
// Sign and send
// ---------------------------------------------------------------------------

export async function sendContract(
  context: CommandContext,
  input: z.infer<typeof sendContractInput>,
) {
  requireOwnerOrAdmin(context.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED");
  const db = getFirestore();
  await requireNativeSigning(db, context.tenantId);
  const draftReference = db.doc(`contractDrafts/${input.projectId}`);
  const draftSnapshot = await draftReference.get();
  if (
    !draftSnapshot.exists ||
    draftSnapshot.get("tenantId") !== context.tenantId ||
    draftSnapshot.get("status") !== "draft"
  )
    throw new Error("CONTRACT_DRAFT_NOT_FOUND");
  if (draftSnapshot.get("documentHash") !== input.documentHash)
    throw new Error("CONTRACT_CHANGED");
  const proposalId = String(draftSnapshot.get("proposalId"));
  await requireContractableProject(db, context.tenantId, input.projectId, proposalId);
  // The records may have moved since the draft was prepared — a corrected
  // proposal, a changed venue. Resolve again from the same template version and
  // refuse if the text is no longer the text the studio read.
  const overrides = (draftSnapshot.get("mergeOverrides") ?? {}) as Record<string, string>;
  const recheck = await resolveDraft(db, {
    tenantId: context.tenantId,
    projectId: input.projectId,
    proposalId,
    templateVersionId: String(draftSnapshot.get("templateVersionId")),
    overrides,
    today: String(draftSnapshot.get("preparedOn") ?? context.timestamp.slice(0, 10)),
  });
  if (recheck.documentHash !== input.documentHash) throw new Error("CONTRACT_CHANGED");
  if (recheck.resolved.unresolved.length) throw new Error("CONTRACT_FIELDS_MISSING");
  if (!recheck.clientEmail) throw new Error("CLIENT_EMAIL_REQUIRED");
  const document: ContractDocument = contractDocumentSchema.parse(recheck.resolved.document);

  let invoicingConnected = false;
  try {
    await requireProviderForTenant(db, context.tenantId, "invoicing");
    invoicingConnected = true;
  } catch {
    invoicingConnected = false;
  }
  const contractId = stableId("contract_sc", context.tenantId, context.idempotencyKey);
  const studioSignatureId = `${contractId}_studio`;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  const contractPath = "/client/contract";

  const result = await db.runTransaction(async (transaction) => {
    const projectReference = db.doc(`projects/${input.projectId}`);
    const orchestrationReference = db.doc(`bookingOrchestrations/${input.projectId}`);
    const decisionTaskReference = db.doc(`tasks/proposal_decision_${proposalId}`);
    const [project, contracts, orchestration, decisionTask, currentDraft] = await Promise.all([
      transaction.get(projectReference),
      transaction.get(
        db
          .collection("contracts")
          .where("tenantId", "==", context.tenantId)
          .where("projectId", "==", input.projectId)
          .limit(25),
      ),
      transaction.get(orchestrationReference),
      transaction.get(decisionTaskReference),
      transaction.get(draftReference),
    ]);
    if (!project.exists || project.get("state") !== "CONTRACT_PENDING")
      throw new Error("CONTRACT_NOT_READY");
    if (currentDraft.get("status") !== "draft") throw new Error("CONTRACT_DRAFT_NOT_FOUND");
    if (currentDraft.get("documentHash") !== input.documentHash)
      throw new Error("CONTRACT_CHANGED");
    if (
      contracts.docs.some(
        (contract) => !DEAD_CONTRACT_STATUSES.has(String(contract.get("status"))),
      )
    )
      throw new Error("CONTRACT_ALREADY_EXISTS");
    const clientContactId = Array.isArray(project.get("clientContactIds"))
      ? String((project.get("clientContactIds") as unknown[])[0] ?? "")
      : "";
    const clientContact = clientContactId
      ? await transaction.get(db.doc(`contacts/${clientContactId}`))
      : null;
    const hasPortalAccess = Boolean(clientContact?.get("portalUserId"));
    const invitation =
      !hasPortalAccess && clientContactId
        ? mintClientInvitation({
            tenantId: context.tenantId,
            projectId: input.projectId,
            email: recheck.clientEmail,
            appUrl,
            next: contractPath,
          })
        : null;

    // --- writes ---
    transaction.create(db.doc(`contractSignatures/${studioSignatureId}`), {
      id: studioSignatureId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      contractId,
      role: "studio",
      signerUid: context.actorId,
      signerEmail: context.actorEmail,
      typedName: input.studioSignerName,
      documentHash: input.documentHash,
      consentVersion: STUDIO_SIGNING_CONSENT_VERSION,
      consentTextHash: sha256Text(STUDIO_SIGNING_STATEMENT),
      authMethod: context.authMethod,
      emailVerified: context.emailVerified,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      signedAt: context.timestamp,
      createdAt: context.timestamp,
    });
    transaction.create(db.doc(`contracts/${contractId}`), {
      id: contractId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      proposalId,
      status: "sent",
      provider: "studiocue",
      providerEnvelopeId: null,
      providerState: "not_applicable",
      templateId: recheck.template.templateId,
      templateVersionId: recheck.template.versionId,
      document,
      documentHash: input.documentHash,
      unresolvedFields: [],
      mergeOverrides: overrides,
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
          name: recheck.clientName || "Client",
          email: recheck.clientEmail,
          role: "primary_client",
          order: 2,
          status: "sent",
          signedAt: null,
        },
      ],
      signatures: [
        {
          id: studioSignatureId,
          role: "studio",
          typedName: input.studioSignerName,
          signedAt: context.timestamp,
        },
      ],
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
    // Kept, not deleted: StudioCue archives rather than deletes. The next
    // prepare overwrites it.
    transaction.update(draftReference, {
      status: "sent",
      sentContractId: contractId,
      updatedAt: context.timestamp,
      updatedBy: context.actorId,
    });
    // The same plan a signing app starts: the retainer follows the signature
    // when an accounting app is connected to raise it; otherwise the studio
    // records the payment, and a retainer that reaches paid books the job.
    if (orchestration.exists && orchestration.get("status") === "active") {
      transaction.update(orchestrationReference, {
        contractId,
        currentStep: "wait_for_signature",
        updatedAt: context.timestamp,
      });
    } else if (!orchestration.exists || orchestration.get("status") !== "completed") {
      transaction.set(orchestrationReference, {
        id: input.projectId,
        tenantId: context.tenantId,
        projectId: input.projectId,
        proposalId,
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
    if (
      decisionTask.exists &&
      decisionTask.get("tenantId") === context.tenantId &&
      !["complete", "completed"].includes(String(decisionTask.get("status")))
    ) {
      transaction.update(decisionTaskReference, {
        status: "complete",
        completedAt: context.timestamp,
        completedBy: context.actorId,
        updatedAt: context.timestamp,
        updatedBy: context.actorId,
      });
    }
    transaction.update(projectReference, {
      nextAction: "Waiting for the client to sign the agreement",
      updatedAt: context.timestamp,
      updatedBy: context.actorId,
    });
    const emailJobId = `contract_ready_${contractId}`;
    transaction.create(db.doc(`emailJobs/${emailJobId}`), {
      id: emailJobId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      contractId,
      type: "contract_ready",
      recipient: recheck.clientEmail,
      recipientName: recheck.clientName,
      actionUrl: invitation ? invitation.inviteUrl : `${appUrl}${contractPath}`,
      signerName: input.studioSignerName,
      status: "queued",
      attempts: 0,
      createdAt: context.timestamp,
      updatedAt: context.timestamp,
    });
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
          tokenHash: invitation.tokenHash,
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
    const auditId = stableId("audit_contract_sent", context.tenantId, context.idempotencyKey);
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      actorType: "user",
      action: "contract.studio_signed_and_sent",
      entityType: "contract",
      entityId: contractId,
      timestamp: context.timestamp,
      before: null,
      after: {
        status: "sent",
        documentHash: input.documentHash,
        templateVersionId: recheck.template.versionId,
        studioSignerName: input.studioSignerName,
        clientEmail: recheck.clientEmail,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    const sentEvent = productEvent({
      tenantId: context.tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      name: "booking.sequence_approved",
      occurredAt: context.timestamp,
      correlationId: context.idempotencyKey,
      sourceEntityType: "bookingOrchestration",
      sourceEntityId: input.projectId,
      properties: { proposalId, contractId, provider: "studiocue" },
    });
    transaction.create(db.doc(`productEvents/${sentEvent.id}`), sentEvent);
    return { contractId, status: "sent", documentHash: input.documentHash };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

export async function voidContract(
  context: CommandContext,
  input: z.infer<typeof voidContractInput>,
) {
  requireOwnerOrAdmin(context.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED");
  const db = getFirestore();
  return voidStudioCueContract(db, {
    tenantId: context.tenantId,
    projectId: input.projectId,
    contractId: input.contractId,
    reason: input.reason,
    actorId: context.actorId,
    actorType: "user",
    timestamp: context.timestamp,
    correlationId: context.idempotencyKey,
    notifyClient: true,
  });
}

/**
 * Withdraw a StudioCue contract that has not been signed. A signed contract is
 * never voided: it is the record of what two parties agreed, and a change is a
 * new agreement. Also called when a proposal is corrected after its contract
 * went out, because the contract's figures are now wrong.
 */
export async function voidStudioCueContract(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    contractId: string;
    reason: string;
    actorId: string;
    actorType: "user" | "system";
    timestamp: string;
    correlationId: string;
    notifyClient: boolean;
  },
) {
  const reference = db.doc(`contracts/${input.contractId}`);
  return db.runTransaction(async (transaction) => {
    const contract = await transaction.get(reference);
    if (
      !contract.exists ||
      contract.get("tenantId") !== input.tenantId ||
      contract.get("projectId") !== input.projectId
    )
      throw new Error("CONTRACT_NOT_FOUND");
    if (contract.get("provider") !== "studiocue") throw new Error("NOT_A_STUDIOCUE_CONTRACT");
    const status = String(contract.get("status"));
    if (status === "voided") return { contractId: contract.id, status, alreadyVoided: true };
    if (status === "completed") throw new Error("SIGNED_CONTRACT_CANNOT_BE_VOIDED");
    if (!["sent", "viewed"].includes(status)) throw new Error("CONTRACT_NOT_VOIDABLE");
    transaction.update(reference, {
      status: "voided",
      voidedAt: input.timestamp,
      voidedBy: input.actorId,
      voidReason: input.reason,
      updatedAt: input.timestamp,
      updatedBy: input.actorId,
    });
    if (input.notifyClient) {
      const signers = Array.isArray(contract.get("signers"))
        ? (contract.get("signers") as Array<Record<string, unknown>>)
        : [];
      const client = signers.find((signer) => signer.role === "primary_client");
      if (client && typeof client.email === "string" && client.email) {
        transaction.create(db.doc(`emailJobs/contract_voided_${contract.id}`), {
          id: `contract_voided_${contract.id}`,
          tenantId: input.tenantId,
          projectId: input.projectId,
          contractId: contract.id,
          type: "contract_voided",
          recipient: client.email,
          recipientName: typeof client.name === "string" ? client.name : null,
          status: "queued",
          attempts: 0,
          createdAt: input.timestamp,
          updatedAt: input.timestamp,
        });
      }
    }
    const auditId = stableId("audit_contract_voided", input.tenantId, input.correlationId, contract.id);
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: "contract.voided",
      entityType: "contract",
      entityId: contract.id,
      timestamp: input.timestamp,
      before: { status },
      after: { status: "voided", reason: input.reason },
      ipAddress: null,
      userAgent: null,
      correlationId: input.correlationId,
      automationRunId: null,
      providerEventId: null,
    });
    return { contractId: contract.id, status: "voided", alreadyVoided: false };
  });
}

export { customFieldKey };

// ---------------------------------------------------------------------------
// On acceptance
// ---------------------------------------------------------------------------

export const setContractAutoSendInput = z.object({
  enabled: z.boolean(),
  /** The owner's name as it will appear on every contract sent for them. */
  signerName: z.string().trim().min(2).max(160).nullable(),
  /** Required to turn it on: adopting a signature is an explicit act. */
  consent: z.boolean(),
});

/**
 * Let StudioCue sign and send for the studio when a proposal is accepted.
 *
 * Off by default. Turning it on adopts the owner's typed name as the studio's
 * signature on every contract sent this way, which is why it needs its own
 * consent and is recorded with who adopted it and when. A contract with any
 * field the records cannot fill is never sent automatically; it waits as a
 * draft for the studio.
 */
export async function setContractAutoSend(
  context: CommandContext,
  input: z.infer<typeof setContractAutoSendInput>,
) {
  requireOwnerOrAdmin(context.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED");
  const db = getFirestore();
  await requireNativeSigning(db, context.tenantId);
  if (input.enabled && (!input.consent || !input.signerName))
    throw new Error("AUTO_SEND_CONSENT_REQUIRED");
  const adoption = input.enabled
    ? {
        enabled: true,
        signerName: input.signerName,
        adoptedBy: context.actorId,
        adoptedByEmail: context.actorEmail,
        adoptedAt: context.timestamp,
        consentVersion: STUDIO_SIGNING_CONSENT_VERSION,
      }
    : { enabled: false, disabledBy: context.actorId, disabledAt: context.timestamp };
  const batch = db.batch();
  batch.update(db.doc(`tenants/${context.tenantId}`), {
    "defaultContractSettings.nativeAutoSend": adoption,
    updatedAt: context.timestamp,
    updatedBy: context.actorId,
  });
  const auditId = stableId("audit_contract_autosend", context.tenantId, context.idempotencyKey);
  batch.create(db.doc(`auditEvents/${auditId}`), {
    id: auditId,
    tenantId: context.tenantId,
    projectId: null,
    actorId: context.actorId,
    actorType: "user",
    action: input.enabled ? "contract.auto_send_enabled" : "contract.auto_send_disabled",
    entityType: "tenant",
    entityId: context.tenantId,
    timestamp: context.timestamp,
    before: null,
    after: adoption,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.idempotencyKey,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return { enabled: input.enabled };
}

/**
 * A proposal was accepted: have the contract ready.
 *
 * Always prepares the draft, so the studio opens the job to a contract waiting
 * for a look rather than a button. Sends it too only when the studio has
 * turned on auto-send and every field resolved from records. Returns what it
 * did so the trigger can log it; never throws for an ordinary "not this time".
 */
export async function prepareOnAcceptance(
  db: Firestore,
  input: { tenantId: string; projectId: string; proposalId: string },
): Promise<{ outcome: string }> {
  if (!(await nativeSigningEnabled(db, input.tenantId))) return { outcome: "not_enabled" };
  const template = await loadAgreementTemplate(db, input.tenantId);
  if (!template) return { outcome: "no_agreement_template" };
  try {
    await requireContractableProject(db, input.tenantId, input.projectId, input.proposalId);
  } catch (caught: unknown) {
    return { outcome: caught instanceof Error ? caught.message : "not_contractable" };
  }
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const draft = await resolveDraft(db, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    proposalId: input.proposalId,
    templateVersionId: null,
    overrides: {},
    today,
  });
  const draftReference = db.doc(`contractDrafts/${input.projectId}`);
  const prepared = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(draftReference);
    // A draft the studio already started on this proposal is theirs; leave it.
    if (
      existing.exists &&
      existing.get("status") === "draft" &&
      existing.get("proposalId") === input.proposalId
    )
      return false;
    transaction.set(draftReference, {
      id: input.projectId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      proposalId: input.proposalId,
      status: "draft",
      sentContractId: null,
      templateId: draft.template.templateId,
      templateVersionId: draft.template.versionId,
      templateVersion: draft.template.version,
      document: draft.resolved.document,
      documentHash: draft.documentHash,
      fields: draft.resolved.fields,
      unresolvedFields: draft.resolved.unresolved,
      mergeOverrides: {},
      preparedOn: today,
      clientName: draft.clientName,
      clientEmail: draft.clientEmail,
      source: "acceptance",
      createdAt: now,
      createdBy: "contract-preparer",
      updatedAt: now,
      updatedBy: "contract-preparer",
    });
    transaction.update(db.doc(`projects/${input.projectId}`), {
      nextAction: draft.resolved.unresolved.length
        ? "Fill in the contract's missing details and send it"
        : "Review the contract and send it",
      updatedAt: now,
      updatedBy: "contract-preparer",
    });
    return true;
  });
  if (!prepared) return { outcome: "draft_already_prepared" };

  const tenant = await db.doc(`tenants/${input.tenantId}`).get();
  const autoSend = ((tenant.get("defaultContractSettings") ?? {}) as Record<string, unknown>)
    .nativeAutoSend as Record<string, unknown> | undefined;
  if (autoSend?.enabled !== true || typeof autoSend.signerName !== "string")
    return { outcome: "prepared" };
  if (draft.resolved.unresolved.length) return { outcome: "prepared_needs_fields" };
  // The adopting owner must still be an owner or admin here, or nobody is
  // signing for the studio.
  const adoptedBy = String(autoSend.adoptedBy ?? "");
  const membership = adoptedBy
    ? await db.doc(`memberships/${input.tenantId}_${adoptedBy}`).get()
    : null;
  if (
    !membership?.exists ||
    membership.get("status") !== "active" ||
    !["studio_owner", "studio_admin"].includes(String(membership.get("role")))
  )
    return { outcome: "prepared_auto_send_signer_inactive" };
  await sendContract(
    {
      tenantId: input.tenantId,
      membership: membership.data() ?? {},
      actorId: adoptedBy,
      actorEmail: typeof autoSend.adoptedByEmail === "string" ? autoSend.adoptedByEmail : null,
      authMethod: "adopted_signature",
      emailVerified: null,
      timestamp: now,
      idempotencyKey: `auto_send:${input.proposalId}`,
      ipAddress: null,
      userAgent: "StudioCue auto-send",
    },
    {
      projectId: input.projectId,
      documentHash: draft.documentHash,
      studioSignerName: autoSend.signerName,
      consent: true,
    },
  );
  return { outcome: "sent" };
}
