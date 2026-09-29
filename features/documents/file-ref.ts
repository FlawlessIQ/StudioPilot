/**
 * A file StudioCue holds, however its record happens to point at it.
 *
 * Signed contracts, proposal and run-of-show PDFs, COIs, questionnaire
 * uploads, message attachments and crew paperwork were all stored, and almost
 * none could be opened from the studio: each record points at its file its
 * own way — a `documents` id, a raw storage path, a `gs://` URL, or a link to
 * another service — and each screen that wanted to open one would have had to
 * know which (docs/document-access-plan-2026-09-28.md). This is where that
 * knowledge lives, so a screen only says "this record has these files".
 *
 * Pure: no Firebase. Resolving a ref to a URL is lib/documents/resolve-file.ts.
 */

export type FileRef =
  | { kind: "document"; id: string; label: string; contentType?: string }
  | { kind: "storage"; path: string; label: string; contentType?: string }
  | { kind: "external"; url: string; label: string };

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * A pointer as records store it, turned into a ref.
 *
 * `signedDocumentId` is a `documents` id for a sealed contract but a raw
 * storage path for one recorded by hand or imported; a COI's pointer is a
 * `gs://` URL. All three read the same from here.
 */
export function refFromPointer(
  pointer: unknown,
  label: string,
  contentType?: string,
): FileRef | null {
  const value = text(pointer);
  if (!value) return null;
  const typed = contentType ? { contentType } : {};
  if (/^https?:\/\//i.test(value)) return { kind: "external", url: value, label };
  if (value.startsWith("gs://") || value.includes("/")) {
    return { kind: "storage", path: value, label, ...typed };
  }
  return { kind: "document", id: value, label, ...typed };
}

/** A link to another service (an invoice, a gallery), or nothing. */
export function externalRef(url: unknown, label: string): FileRef | null {
  const value = text(url);
  return /^https?:\/\//i.test(value) ? { kind: "external", url: value, label } : null;
}

/** The same file twice (a native contract's signed copy is its certificate). */
function unique(refs: Array<FileRef | null>): FileRef[] {
  const seen = new Set<string>();
  const out: FileRef[] = [];
  for (const ref of refs) {
    if (!ref) continue;
    const key = fileRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export function fileRefKey(ref: FileRef): string {
  return ref.kind === "document" ? `document:${ref.id}` : ref.kind === "storage" ? `storage:${ref.path}` : `external:${ref.url}`;
}

/** What a file is, from its name or declared type — for its icon and preview. */
export function fileKindOf(nameOrType: string): "pdf" | "image" | "video" | "other" {
  const value = nameOrType.toLowerCase();
  if (value.includes("pdf")) return "pdf";
  if (/^image\/|\.(png|jpe?g|gif|webp|heic|heif)(?:$|\?)/.test(value)) return "image";
  if (/^video\/|\.(mp4|mov|m4v|webm)(?:$|\?)/.test(value)) return "video";
  return "other";
}

/**
 * The record types that carry files, and how to find them. Every file field
 * in the audit table of the plan is here, and tests/file-ref.test.ts checks
 * that it stays that way.
 */
export const FILE_BEARING = {
  contracts(contract: Row): FileRef[] {
    return unique([
      refFromPointer(contract.signedDocumentId, "Signed contract", "application/pdf"),
      refFromPointer(contract.certificateDocumentId, "Signing certificate", "application/pdf"),
    ]);
  },
  proposals(proposal: Row): FileRef[] {
    const version = Number(proposal.version ?? 0);
    return unique([
      refFromPointer(
        proposal.pdfDocumentId,
        version > 1 ? `Proposal (version ${version})` : "Proposal",
        "application/pdf",
      ),
    ]);
  },
  schedules(schedule: Row): FileRef[] {
    return unique([refFromPointer(schedule.pdfDocumentId, "Run of show", "application/pdf")]);
  },
  projectCloseouts(closeout: Row): FileRef[] {
    return unique([refFromPointer(closeout.summaryDocumentId, "Closeout summary", "application/pdf")]);
  },
  insuranceRequests(request: Row): FileRef[] {
    const name = text(request.sourceFilename) || "Certificate of insurance";
    // Approved: the filed copy. Before that, the file as it arrived.
    return unique([
      refFromPointer(request.documentId, name, "application/pdf") ??
        refFromPointer(request.temporaryObject, name, "application/pdf"),
    ]);
  },
  questionnaireResponses(response: Row): FileRef[] {
    return unique(
      Object.values(record(response.answers)).flatMap((answer) => fileAnswerRefs(answer)),
    );
  },
  invoiceReferences(invoice: Row): FileRef[] {
    const number = text(invoice.docNumber) || text(invoice.invoiceNumber);
    return unique([externalRef(invoice.hostedUrl, number ? `Invoice ${number}` : "Invoice")]);
  },
  deliveryRecords(delivery: Row): FileRef[] {
    return unique([externalRef(delivery.galleryUrl, text(delivery.label) || "Gallery")]);
  },
  crewAssignments(assignment: Row): FileRef[] {
    return unique(
      list(assignment.requirements).map((requirement) => {
        const row = record(requirement);
        return refFromPointer(row.documentId, text(row.name) || "Crew document");
      }),
    );
  },
  crewProfiles(profile: Row): FileRef[] {
    return unique([
      refFromPointer(profile.w9DocumentPath, "W-9"),
      refFromPointer(profile.insuranceDocumentPath, "Insurance certificate"),
    ]);
  },
  messages(message: Row): FileRef[] {
    return unique(list(message.attachmentReferences).map((attachment) => attachmentRef(attachment)));
  },
  studioImportItems(item: Row): FileRef[] {
    return unique([
      refFromPointer(item.storageObjectKey, text(item.name) || text(item.fileName) || "Source file"),
    ]);
  },
} as const satisfies Record<string, (row: Row) => FileRef[]>;

export type FileBearingCollection = keyof typeof FILE_BEARING;

export function fileRefsFor(collection: FileBearingCollection, row: Row): FileRef[] {
  return FILE_BEARING[collection](row);
}

/** An uploaded attachment: `{storagePath, name, contentType}`. */
export function attachmentRef(value: unknown): FileRef | null {
  const row = record(value);
  const path = text(row.storagePath);
  if (!path) return null;
  const contentType = text(row.contentType);
  return {
    kind: "storage",
    path,
    label: text(row.name) || path.split("/").pop() || "Attachment",
    ...(contentType ? { contentType } : {}),
  };
}

/** A questionnaire answer that is a file, or several. */
export function fileAnswerRefs(answer: unknown): FileRef[] {
  if (Array.isArray(answer)) return unique(answer.map((item) => attachmentRef(item)));
  return unique([attachmentRef(answer)]);
}
