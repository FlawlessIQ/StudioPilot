import { createHash } from "node:crypto";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { contractDocumentSchema } from "./document.js";
import { contractDocumentHash } from "./document-hash.js";

/**
 * The signed copy of a StudioCue contract: rendered once, stored once, sent
 * to the couple.
 *
 * Queued by the portal's signing transaction as `pdfJobs/contract_seal_{id}`.
 * The contract is already complete when this runs — the signature record is
 * the evidence, and a PDF-service outage delays the copy, never the booking.
 *
 * Before rendering, the stored document is hashed again and compared with the
 * hash both parties signed. A mismatch means the record was altered after
 * signing, and the job fails loudly rather than print a certificate for text
 * nobody signed.
 */

type Data = Record<string, unknown>;
const record = (value: unknown): Data =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function formatSigningTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    })
      .format(date)
      .replace(/, (\d{1,2}:\d{2})/, " at $1");
  } catch {
    return `${iso.replace("T", " ").slice(0, 16)} UTC`;
  }
}

const authMethodLabel = (value: string): string =>
  ({
    password: "Email and password",
    emailLink: "Email sign-in link",
    "google.com": "Google",
    "apple.com": "Apple",
  })[value] ?? value;

export async function contractPdfInput(
  db: Firestore,
  job: DocumentSnapshot,
  tenantName: string,
) {
  const contract = await db.doc(`contracts/${String(job.get("contractId"))}`).get();
  if (!contract.exists || contract.get("tenantId") !== job.get("tenantId"))
    throw new Error("CONTRACT_NOT_FOUND");
  if (contract.get("provider") !== "studiocue") throw new Error("NOT_A_STUDIOCUE_CONTRACT");
  if (contract.get("status") !== "completed") throw new Error("CONTRACT_NOT_COMPLETED");
  const document = contractDocumentSchema.parse(contract.get("document"));
  const documentHash = text(contract.get("documentHash"));
  if (contractDocumentHash(document) !== documentHash)
    throw new Error("CONTRACT_DOCUMENT_HASH_MISMATCH");
  const signatureSummaries = Array.isArray(contract.get("signatures"))
    ? (contract.get("signatures") as unknown[]).map(record)
    : [];
  const signatures = await Promise.all(
    signatureSummaries.map((summary) => db.doc(`contractSignatures/${text(summary.id)}`).get()),
  );
  if (signatures.some((signature) => !signature.exists))
    throw new Error("CONTRACT_SIGNATURE_NOT_FOUND");
  for (const signature of signatures) {
    if (signature.get("documentHash") !== documentHash)
      throw new Error("CONTRACT_SIGNATURE_HASH_MISMATCH");
  }
  const [project, templateVersion] = await Promise.all([
    db.doc(`projects/${String(contract.get("projectId"))}`).get(),
    db.doc(`agreementTemplateVersions/${text(contract.get("templateVersionId"))}`).get(),
  ]);
  const tenant = await db.doc(`tenants/${String(contract.get("tenantId"))}`).get();
  // The letterhead lives with the email branding, so a studio sets it once.
  const branding = (tenant.get("emailBranding") ?? {}) as {
    logoUrl?: string | null;
    postalAddress?: string | null;
    phone?: string | null;
    replyTo?: string | null;
    websiteUrl?: string | null;
  };
  const timeZone =
    text(project.get("timezone")) || text(tenant.get("timezone")) || "America/New_York";
  const when = (iso: unknown) => formatSigningTime(text(iso), timeZone);
  const studio = signatures.find((signature) => signature.get("role") === "studio");
  const client = signatures.find((signature) => signature.get("role") === "client");
  const clientSigner = (Array.isArray(contract.get("signers"))
    ? (contract.get("signers") as unknown[]).map(record)
    : []
  ).find((signer) => signer.role === "primary_client");
  const templateName = templateVersion.exists
    ? `${text(templateVersion.get("title")) || "Agreement"} · version ${Number(templateVersion.get("version") ?? 1)}`
    : text(contract.get("templateVersionId")) || "Agreement";
  const events = [
    {
      at: when(contract.get("createdAt")),
      description: `Prepared from ${templateName} and the accepted proposal`,
    },
    ...(studio
      ? [
          {
            at: when(studio.get("signedAt")),
            description: `Signed by ${text(studio.get("typedName"))} for ${tenantName} and sent to ${text(clientSigner?.email) || "the client"}`,
          },
        ]
      : []),
    ...(contract.get("viewedAt")
      ? [{ at: when(contract.get("viewedAt")), description: "Opened by the client" }]
      : []),
    ...(client
      ? [
          {
            at: when(client.get("signedAt")),
            description: `Signed by ${text(client.get("typedName"))} — agreement complete`,
          },
        ]
      : []),
  ];
  return {
    endpoint: "contracts",
    entity: contract,
    payload: {
      tenant_name: tenantName,
      /**
       * The studio's letterhead, from the same branding record its emails and
       * proposals use — set once, on every document it sends.
       */
      logo_url: branding.logoUrl ?? "",
      studio_address: branding.postalAddress ?? "",
      studio_phone: branding.phone ?? "",
      studio_email: branding.replyTo ?? "",
      studio_website: branding.websiteUrl ?? "",
      project_id: String(contract.get("projectId")),
      contract_id: contract.id,
      title: document.title,
      blocks: document.blocks,
      document_hash: documentHash,
      template_version: templateName,
      signatures: signatures.map((signature) => ({
        role: signature.get("role"),
        typed_name: text(signature.get("typedName")),
        email: text(signature.get("signerEmail")) || null,
        signed_at: when(signature.get("signedAt")),
        ip_address: text(signature.get("ipAddress")) || null,
        user_agent: text(signature.get("userAgent")).slice(0, 500) || null,
        auth_method: signature.get("authMethod")
          ? authMethodLabel(text(signature.get("authMethod")))
          : null,
        consent_version: text(signature.get("consentVersion")) || "unknown",
      })),
      events,
      generated_at: when(new Date().toISOString()),
    },
  };
}

function fileName(title: string, projectName: string): string {
  const slug = `${projectName || "agreement"}-${title || "signed"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${slug || "signed-agreement"}-signed.pdf`;
}

/**
 * Store the sealed copy, point the contract at it, and send the couple theirs.
 * Idempotent: a retried job that finds the copy already recorded returns it.
 */
export async function storeSealedContract(
  db: Firestore,
  job: DocumentSnapshot,
  contract: DocumentSnapshot,
  bytes: Buffer,
) {
  const tenantId = String(job.get("tenantId"));
  const projectId = String(job.get("projectId"));
  const documentId = `signed_contract_${contract.id}`;
  const existing = await db.doc(`documents/${documentId}`).get();
  if (existing.exists && contract.get("signedDocumentId") === documentId) {
    return { documentId, alreadySealed: true };
  }
  const path = `tenants/${tenantId}/projects/${projectId}/contracts/signed/${contract.id}.pdf`;
  await getStorage().bucket().file(path).save(bytes, {
    contentType: "application/pdf",
    resumable: false,
    metadata: {
      metadata: {
        scanStatus: "clean",
        visibility: "client",
        trustedGenerator: "studiohub-pdf",
        contractId: contract.id,
        documentHash: String(contract.get("documentHash")),
      },
    },
  });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const now = new Date().toISOString();
  const project = await db.doc(`projects/${projectId}`).get();
  const title = text(record(contract.get("document")).title);
  const name = fileName(title, text(project.get("name")));
  const client = (Array.isArray(contract.get("signers"))
    ? (contract.get("signers") as unknown[]).map(record)
    : []
  ).find((signer) => signer.role === "primary_client");
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(contract.ref);
    transaction.set(db.doc(`documents/${documentId}`), {
      id: documentId,
      tenantId,
      projectId,
      provider: "cloud_storage",
      providerFileId: path,
      providerRevision: null,
      canonicalPath: path,
      name,
      category: "contract",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      sha256,
      visibility: "client",
      status: "available",
      contractId: contract.id,
      createdAt: now,
      updatedAt: now,
      createdBy: "pdf-worker",
      updatedBy: "pdf-worker",
      archivedAt: null,
    });
    const emailCopy =
      !current.get("signedCopyEmailedAt") && client && typeof client.email === "string";
    transaction.update(contract.ref, {
      signedDocumentId: documentId,
      certificateDocumentId: documentId,
      fileHash: sha256,
      sealedAt: now,
      ...(emailCopy ? { signedCopyEmailedAt: now } : {}),
      updatedAt: now,
      updatedBy: "pdf-worker",
    });
    if (emailCopy && client) {
      transaction.set(db.doc(`emailJobs/contract_signed_${contract.id}`), {
        id: `contract_signed_${contract.id}`,
        tenantId,
        projectId,
        contractId: contract.id,
        type: "contract_signed",
        recipient: client.email,
        recipientName: typeof client.name === "string" ? client.name : null,
        attachmentDocumentId: documentId,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }, { merge: false });
    }
  });
  return { documentId, path, sha256, sizeBytes: bytes.length, alreadySealed: false };
}
