import { z } from "zod";
import type { AuditEvent } from "@/features/audit/schema";
import { authorize, type AuthorizationContext } from "@/features/auth/authorize";
import {
  STUDIO_IMPORT_MAX_FILES,
  studioImportItemSchema,
  studioImportSessionSchema,
  validateStudioImportFileCandidate,
  type StudioImportFileCandidate,
  type StudioImportItem,
  type StudioImportSession,
} from "@/features/studio-import/schema";

export type StudioImportSessionBundle = {
  session: StudioImportSession;
  items: StudioImportItem[];
};

export interface StudioImportStore {
  findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<StudioImportSessionBundle | null>;
  createSessionWithItems(bundle: StudioImportSessionBundle): Promise<void>;
}

export interface StudioImportAuditStore {
  append(event: AuditEvent): Promise<void>;
}

const createStudioImportInputSchema = z.object({
  idempotencyKey: z.string().min(8).max(240),
  files: z
    .array(
      z.object({
        clientId: z.string().min(1).max(240),
        name: z.string().trim().min(1).max(240),
        sizeBytes: z.number(),
        contentType: z.string().max(160),
        lastModifiedAt: z.string().datetime().nullable().optional(),
      }),
    )
    .min(1)
    .max(STUDIO_IMPORT_MAX_FILES),
});

export class StudioImportService {
  constructor(
    private readonly store: StudioImportStore,
    private readonly audits: StudioImportAuditStore,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createFileSession(
    context: AuthorizationContext,
    input: {
      idempotencyKey: string;
      files: readonly StudioImportFileCandidate[];
    },
    correlationId: string,
  ): Promise<StudioImportSessionBundle> {
    authorize(context, "workflows.manage");
    const parsed = createStudioImportInputSchema.parse(input);
    const prior = await this.store.findByIdempotencyKey(
      context.tenantId,
      parsed.idempotencyKey,
    );
    if (prior) return prior;

    const clientIds = new Set<string>();
    const validated = parsed.files.map((file) => {
      if (clientIds.has(file.clientId)) {
        throw new Error(`Duplicate import source: ${file.name}.`);
      }
      clientIds.add(file.clientId);
      const result = validateStudioImportFileCandidate(file);
      if (!result.accepted) {
        throw new Error(`${result.code}: ${result.message}`);
      }
      return result.candidate;
    });

    const timestamp = this.now();
    const sessionId = this.createId();
    const items = validated.map((file) =>
      studioImportItemSchema.parse({
        id: this.createId(),
        tenantId: context.tenantId,
        sessionId,
        sourceType: "file",
        name: file.name,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        sha256: null,
        storageProvider: null,
        storageObjectKey: null,
        status: "awaiting_upload",
        safety: {
          signatureVerifiedAt: null,
          malwareScanStatus: "pending",
          malwareScannedAt: null,
          rejectionCode: null,
        },
        classification: null,
        failure: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: context.userId,
        updatedBy: context.userId,
        archivedAt: null,
      }),
    );
    const session = studioImportSessionSchema.parse({
      id: sessionId,
      tenantId: context.tenantId,
      sourceMode: "files",
      status: "awaiting_upload",
      idempotencyKey: parsed.idempotencyKey,
      itemIds: items.map((item) => item.id),
      itemCount: items.length,
      totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
      approvedItemIds: [],
      ignoredItemIds: [],
      activatedAssetVersionIds: [],
      reviewReadyAt: null,
      approvedAt: null,
      activatedAt: null,
      cancelledAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: context.userId,
      updatedBy: context.userId,
      archivedAt: null,
    });

    const bundle = { session, items };
    await this.store.createSessionWithItems(bundle);
    await this.audits.append({
      id: this.createId(),
      tenantId: context.tenantId,
      actorId: context.userId,
      actorType: "user",
      action: "studio_import.session_created",
      entityType: "studioImportSession",
      entityId: session.id,
      timestamp,
      before: null,
      after: {
        status: session.status,
        itemCount: session.itemCount,
        totalBytes: session.totalBytes,
      },
      ipAddress: null,
      userAgent: null,
      correlationId,
      automationRunId: null,
      providerEventId: null,
    });
    return bundle;
  }
}
