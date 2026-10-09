import { createHash } from "node:crypto";
import type { DocumentReference, DocumentSnapshot, Firestore, SetOptions } from "firebase-admin/firestore";

/** A transaction or a batch: whichever the change to the bill is going out with. */
export type InvoiceWriter = {
  set(reference: DocumentReference, data: Record<string, unknown>, options?: SetOptions): unknown;
};
import { getStorage } from "firebase-admin/storage";
import { normaliseStudioInvoiceSettings } from "./studio-invoice-settings.js";
import {
  studioInvoiceFileName,
  studioInvoicePdfPayload,
  studioInvoiceSource,
  type StudioInvoicePdfPayload,
} from "./studio-invoice-document.js";

/**
 * The PDF of an invoice StudioCue issues for a studio that bills a job itself
 * (own invoicing, Phase 1; docs/own-invoicing-plan-2026-10-09.md).
 *
 * Every change to the bill — issued, a payment, a void — queues a new
 * revision (`pdfJobs/invoice_<id>_r<n>`), rendered by the PDF service
 * (cloud-run/pdf/invoice.py) through the same worker as every other PDF
 * (operations/ai-pdf.ts). Each revision is kept at its own path; the
 * invoice's `pdf` and one `documents/studio_invoice_<id>` row point at the
 * latest, visible to the client and the studio, never crew.
 *
 * A revision that lands after a newer one is dropped, so a slow render can't
 * put an old balance back in front of the client.
 */

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const INVOICE_PDF_JOB_TYPE = "invoice_pdf";

export function invoicePdfJobId(invoiceId: string, revision: number): string {
  return `invoice_${invoiceId}_r${revision}`;
}

export function invoicePdfPath(tenantId: string, projectId: string, invoiceId: string, revision: number): string {
  return `tenants/${tenantId}/projects/${projectId}/invoices/${invoiceId}/r${revision}.pdf`;
}

export function invoicePdfDocumentId(invoiceId: string): string {
  return `studio_invoice_${invoiceId}`;
}

/**
 * Queue the next revision with the write (transaction or batch) that changed the bill.
 * The caller has read the invoice; pass its current `pdfRevision`.
 * Returns the revision queued, which the caller writes as `pdfRevision`.
 */
export function queueStudioInvoicePdf(
  db: Firestore,
  transaction: InvoiceWriter,
  input: { tenantId: string; projectId: string; invoiceId: string; currentRevision: unknown; now: string },
): number {
  const prior = Number(input.currentRevision);
  const revision = Number.isSafeInteger(prior) && prior >= 0 ? prior + 1 : 1;
  const id = invoicePdfJobId(input.invoiceId, revision);
  transaction.set(db.doc(`pdfJobs/${id}`), {
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    invoiceId: input.invoiceId,
    revision,
    type: INVOICE_PDF_JOB_TYPE,
    status: "queued",
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return revision;
}

/** "88 Orchard Lane", "Rhinebeck, NY 12572" from a stored billing address. */
export function billingAddressLines(value: unknown): string[] {
  const address = record(value);
  const cityLine = [
    text(address.city),
    [text(address.region), text(address.postalCode)].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const country = text(address.country);
  return [text(address.line1), text(address.line2), cityLine, country && country !== "US" ? country : ""].filter(Boolean);
}

/** Everything the PDF service needs, read fresh from the stored records. */
export async function studioInvoicePdfInput(
  db: Firestore,
  job: DocumentSnapshot,
): Promise<{ endpoint: "invoices"; entity: DocumentSnapshot; fileName: string; payload: StudioInvoicePdfPayload }> {
  const tenantId = text(job.get("tenantId"));
  const invoiceSnapshot = await db.doc(`invoiceReferences/${text(job.get("invoiceId"))}`).get();
  if (!invoiceSnapshot.exists || invoiceSnapshot.get("tenantId") !== tenantId) throw new Error("INVOICE_NOT_FOUND");
  const invoice = studioInvoiceSource(invoiceSnapshot.id, invoiceSnapshot.data());
  if (!invoice) throw new Error("NOT_A_STUDIO_INVOICE");
  const [tenant, settingsDoc, project] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.doc(`billingSettings/${tenantId}`).get(),
    db.doc(`projects/${invoice.projectId}`).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
  const contactIds = Array.isArray(project.get("clientContactIds")) ? (project.get("clientContactIds") as unknown[]) : [];
  const contactId = contactIds.find((value): value is string => typeof value === "string" && value.length > 0);
  const contact = contactId ? await db.doc(`contacts/${contactId}`).get() : null;
  const client = contact?.exists && contact.get("tenantId") === tenantId ? contact : null;
  const settings = normaliseStudioInvoiceSettings(
    settingsDoc.exists && settingsDoc.get("tenantId") === tenantId ? settingsDoc.data() : null,
  );
  const jobName = text(project.get("name")) || null;
  return {
    endpoint: "invoices",
    entity: invoiceSnapshot,
    fileName: studioInvoiceFileName(invoice.number, jobName),
    payload: studioInvoicePdfPayload({
      invoice,
      studio: {
        name: text(tenant.get("brandName")) || text(tenant.get("businessName")) || "Studio",
        logoUrl: text(record(tenant.get("emailBranding")).logoUrl) || text(tenant.get("logoUrl")) || null,
        settings,
      },
      client: {
        name: client ? text(client.get("displayName")) || [text(client.get("firstName")), text(client.get("lastName"))].filter(Boolean).join(" ") : null,
        email: client ? text(client.get("email")) : null,
        addressLines: client ? billingAddressLines(client.get("billingAddress")) : [],
      },
      job: { name: jobName, eventDate: text(project.get("eventDate")) || null },
      generatedAt: new Date().toISOString(),
    }),
  };
}

/**
 * Keep the rendered revision and point the invoice at it — unless a newer
 * revision has already landed, in which case this one is dropped.
 */
export async function storeStudioInvoicePdf(
  db: Firestore,
  job: DocumentSnapshot,
  fileName: string,
  bytes: Buffer,
): Promise<Record<string, unknown>> {
  const tenantId = text(job.get("tenantId"));
  const projectId = text(job.get("projectId"));
  const invoiceId = text(job.get("invoiceId"));
  const revision = Number(job.get("revision"));
  const path = invoicePdfPath(tenantId, projectId, invoiceId, revision);
  await getStorage()
    .bucket()
    .file(path)
    .save(bytes, {
      contentType: "application/pdf",
      resumable: false,
      metadata: {
        metadata: { scanStatus: "clean", visibility: "client", trustedGenerator: "studiohub-pdf", invoiceId },
      },
    });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const now = new Date().toISOString();
  const documentId = invoicePdfDocumentId(invoiceId);
  const invoiceReference = db.doc(`invoiceReferences/${invoiceId}`);
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(invoiceReference);
    if (!current.exists || current.get("tenantId") !== tenantId) throw new Error("INVOICE_NOT_FOUND");
    const landed = Number(record(current.get("pdf")).revision ?? 0);
    if (landed >= revision) return { documentId, path, revision, stale: true };
    transaction.set(db.doc(`documents/${documentId}`), {
      id: documentId,
      tenantId,
      projectId,
      provider: "cloud_storage",
      providerFileId: path,
      providerRevision: String(revision),
      canonicalPath: path,
      name: fileName,
      category: "invoice",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      sha256,
      visibility: "client",
      status: "available",
      invoiceId,
      createdAt: now,
      updatedAt: now,
      createdBy: "pdf-worker",
      updatedBy: "pdf-worker",
      archivedAt: null,
    });
    transaction.update(invoiceReference, {
      pdf: { documentId, path, sha256, revision, renderedAt: now },
      updatedAt: now,
      updatedBy: "pdf-worker",
    });
    return { documentId, path, sha256, sizeBytes: bytes.length, revision, stale: false };
  });
}
