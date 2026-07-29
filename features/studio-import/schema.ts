import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const STUDIO_IMPORT_MAX_FILES = 12;
export const STUDIO_IMPORT_MAX_FILE_BYTES = 12 * 1024 * 1024;

export const studioImportAllowedExtensions = [
  "pdf",
  "doc",
  "docx",
  "txt",
  "csv",
  "rtf",
] as const;

export const studioImportAllowedContentTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "application/rtf",
  "text/rtf",
  "application/octet-stream",
] as const;

export const studioImportSourceTypeSchema = z.enum([
  "file",
  "email_text",
  "website",
]);

export const studioAssetTypeSchema = z.enum([
  "message_template",
  "package",
  "proposal",
  "contract",
  "questionnaire",
  "schedule",
  "timing_rule",
  "crew_preference",
  "coi_instruction",
  "delivery_instruction",
  "review_request",
  "workflow",
]);

export type StudioAssetType = z.infer<typeof studioAssetTypeSchema>;

export const studioImportFileCandidateSchema = z.object({
  clientId: z.string().min(1).max(240),
  name: z.string().trim().min(1).max(240),
  sizeBytes: z.number().int().positive().max(STUDIO_IMPORT_MAX_FILE_BYTES),
  contentType: z.string().trim().min(1).max(160),
  lastModifiedAt: z.string().datetime().nullable(),
});

export type StudioImportFileCandidate = z.infer<
  typeof studioImportFileCandidateSchema
>;

export type StudioImportFileValidation =
  | {
      accepted: true;
      candidate: StudioImportFileCandidate;
      extension: (typeof studioImportAllowedExtensions)[number];
    }
  | {
      accepted: false;
      code:
        | "INVALID_METADATA"
        | "EMPTY_FILE"
        | "FILE_TOO_LARGE"
        | "UNSUPPORTED_EXTENSION"
        | "UNSUPPORTED_CONTENT_TYPE";
      message: string;
    };

function fileExtension(name: string): string {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

export function validateStudioImportFileCandidate(input: {
  clientId: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  lastModifiedAt?: string | null;
}): StudioImportFileValidation {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return {
      accepted: false,
      code: "EMPTY_FILE",
      message: "This file is empty and cannot be imported.",
    };
  }
  if (input.sizeBytes > STUDIO_IMPORT_MAX_FILE_BYTES) {
    return {
      accepted: false,
      code: "FILE_TOO_LARGE",
      message: "Files must be 12 MB or smaller.",
    };
  }

  const extension = fileExtension(input.name);
  if (
    !studioImportAllowedExtensions.includes(
      extension as (typeof studioImportAllowedExtensions)[number],
    )
  ) {
    return {
      accepted: false,
      code: "UNSUPPORTED_EXTENSION",
      message: "Use a PDF, Word, text, CSV, or RTF file.",
    };
  }

  const contentType = input.contentType || "application/octet-stream";
  if (
    !studioImportAllowedContentTypes.includes(
      contentType as (typeof studioImportAllowedContentTypes)[number],
    )
  ) {
    return {
      accepted: false,
      code: "UNSUPPORTED_CONTENT_TYPE",
      message: "The file type reported by your browser is not supported.",
    };
  }

  const parsed = studioImportFileCandidateSchema.safeParse({
    ...input,
    contentType,
    lastModifiedAt: input.lastModifiedAt ?? null,
  });
  if (!parsed.success) {
    return {
      accepted: false,
      code: "INVALID_METADATA",
      message: "The file details could not be validated.",
    };
  }

  return {
    accepted: true,
    candidate: parsed.data,
    extension: extension as (typeof studioImportAllowedExtensions)[number],
  };
}

export const studioImportItemStatusSchema = z.enum([
  "awaiting_upload",
  "quarantined",
  "scanning",
  "rejected",
  "ready_for_analysis",
  "analyzing",
  "review_ready",
  "approved",
  "ignored",
  "failed",
  "cancelled",
]);

export const studioImportSafetySchema = z.object({
  signatureVerifiedAt: z.string().datetime().nullable(),
  malwareScanStatus: z.enum(["pending", "passed", "failed", "unavailable"]),
  malwareScannedAt: z.string().datetime().nullable(),
  rejectionCode: z.string().max(120).nullable(),
});

export const studioImportClassificationSchema = z.object({
  assetTypes: z.array(studioAssetTypeSchema).min(1),
  confidence: z.number().min(0).max(1),
  modelVersion: z.string().min(1),
  instructionVersion: z.string().min(1),
  citations: z.array(
    z.object({
      sourceLabel: z.string().min(1).max(240),
      locator: z.string().min(1).max(500),
      excerptHash: z.string().min(16).max(128).nullable(),
    }),
  ),
});

export const studioImportItemSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  sourceType: studioImportSourceTypeSchema,
  name: z.string().min(1).max(240),
  contentType: z.string().min(1).max(160),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().length(64).nullable(),
  storageProvider: z.enum(["gcs", "r2"]).nullable(),
  storageObjectKey: z.string().min(1).max(1000).nullable(),
  status: studioImportItemStatusSchema,
  safety: studioImportSafetySchema,
  classification: studioImportClassificationSchema.nullable(),
  failure: z
    .object({
      code: z.string().min(1).max(120),
      message: z.string().min(1).max(1000),
      retryable: z.boolean(),
    })
    .nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type StudioImportItem = z.infer<typeof studioImportItemSchema>;

export const studioImportSessionStatusSchema = z.enum([
  "draft",
  "awaiting_upload",
  "processing",
  "review_ready",
  "approved",
  "activated",
  "partially_failed",
  "failed",
  "cancelled",
]);

export const studioImportSessionSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  sourceMode: z.enum(["files", "email", "website", "mixed"]),
  status: studioImportSessionStatusSchema,
  idempotencyKey: z.string().min(8).max(240),
  itemIds: z.array(z.string().min(1)).max(STUDIO_IMPORT_MAX_FILES),
  itemCount: z.number().int().min(1).max(STUDIO_IMPORT_MAX_FILES),
  totalBytes: z.number().int().nonnegative(),
  approvedItemIds: z.array(z.string().min(1)),
  ignoredItemIds: z.array(z.string().min(1)),
  activatedAssetVersionIds: z.array(z.string().min(1)),
  reviewReadyAt: z.string().datetime().nullable(),
  approvedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type StudioImportSession = z.infer<typeof studioImportSessionSchema>;

export const studioAssetVersionSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  assetId: z.string().min(1),
  importSessionId: z.string().nullable(),
  sourceItemIds: z.array(z.string().min(1)),
  assetType: studioAssetTypeSchema,
  name: z.string().min(1).max(240),
  version: z.number().int().positive(),
  status: z.enum(["draft", "active", "superseded", "archived"]),
  structuredContent: z.record(z.string(), z.unknown()),
  sourceCitations: z.array(
    z.object({
      itemId: z.string().min(1),
      locator: z.string().min(1).max(500),
      excerptHash: z.string().min(16).max(128).nullable(),
    }),
  ),
  validation: z.object({
    status: z.enum(["pending", "passed", "failed"]),
    issues: z.array(
      z.object({
        code: z.string().min(1).max(120),
        severity: z.enum(["info", "warning", "blocking"]),
        message: z.string().min(1).max(1000),
      }),
    ),
  }),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
  supersededAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type StudioAssetVersion = z.infer<typeof studioAssetVersionSchema>;

export const studioAssetSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  assetType: studioAssetTypeSchema,
  name: z.string().min(1).max(240),
  activeVersionId: z.string().nullable(),
  latestVersion: z.number().int().positive(),
  archivedAt: z.string().datetime().nullable(),
});

export type StudioAsset = z.infer<typeof studioAssetSchema>;
