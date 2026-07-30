import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent } from "@/features/audit/schema";
import type { AuthorizationContext } from "@/features/auth/authorize";
import {
  aiActionMayExecute,
  aiActionSchema,
} from "@/features/ai-actions/schema";
import {
  productEventSchema,
  verifiedSecondsSaved,
} from "@/features/operations/event-taxonomy";
import {
  STUDIO_IMPORT_MAX_FILE_BYTES,
  studioAssetVersionSchema,
  validateStudioImportFileCandidate,
} from "@/features/studio-import/schema";
import {
  roadmapFeatureDefaults,
  roadmapFeatureRegistry,
} from "@/config/roadmap-feature-flags";
import {
  StudioImportService,
  type StudioImportAuditStore,
  type StudioImportSessionBundle,
  type StudioImportStore,
} from "@/server/services/studio-import-service";
import {
  studioImportObjectPath,
  validateStudioImportMetadata,
  verifyStudioImportFileSignature,
} from "../functions/src/studio-import/domain";

const timestamp = "2026-07-29T20:00:00.000Z";

const ownerContext: AuthorizationContext = {
  userId: "owner-1",
  tenantId: "tenant-1",
  membershipTenantId: "tenant-1",
  role: "studio_owner",
};

class MemoryImportStore implements StudioImportStore {
  bundles: StudioImportSessionBundle[] = [];

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return (
      this.bundles.find(
        ({ session }) =>
          session.tenantId === tenantId &&
          session.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async createSessionWithItems(bundle: StudioImportSessionBundle) {
    this.bundles.push(bundle);
  }
}

class MemoryImportAuditStore implements StudioImportAuditStore {
  events: AuditEvent[] = [];

  async append(event: AuditEvent) {
    this.events.push(event);
  }
}

function idFactory() {
  let index = 0;
  return () => `generated-${++index}`;
}

test("studio import file policy accepts known formats and rejects unsafe metadata", () => {
  const accepted = validateStudioImportFileCandidate({
    clientId: "file-1",
    name: "wedding-contract.docx",
    sizeBytes: 2048,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    lastModifiedAt: timestamp,
  });
  assert.equal(accepted.accepted, true);

  const oversized = validateStudioImportFileCandidate({
    clientId: "file-2",
    name: "packages.pdf",
    sizeBytes: STUDIO_IMPORT_MAX_FILE_BYTES + 1,
    contentType: "application/pdf",
    lastModifiedAt: timestamp,
  });
  assert.equal(oversized.accepted, false);
  if (!oversized.accepted) assert.equal(oversized.code, "FILE_TOO_LARGE");

  const executable = validateStudioImportFileCandidate({
    clientId: "file-3",
    name: "template.exe",
    sizeBytes: 1024,
    contentType: "application/octet-stream",
    lastModifiedAt: timestamp,
  });
  assert.equal(executable.accepted, false);
  if (!executable.accepted) {
    assert.equal(executable.code, "UNSUPPORTED_EXTENSION");
  }
});

test("studio import session creation is authorized, tenant-scoped, and idempotent", async () => {
  const store = new MemoryImportStore();
  const audits = new MemoryImportAuditStore();
  const service = new StudioImportService(
    store,
    audits,
    idFactory(),
    () => timestamp,
  );
  const input = {
    idempotencyKey: "tenant-1|studio-import|one",
    files: [
      {
        clientId: "contract-1",
        name: "wedding-contract.pdf",
        sizeBytes: 4096,
        contentType: "application/pdf",
        lastModifiedAt: timestamp,
      },
      {
        clientId: "schedule-1",
        name: "sample-run-of-show.docx",
        sizeBytes: 8192,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        lastModifiedAt: timestamp,
      },
    ],
  } as const;

  const first = await service.createFileSession(
    ownerContext,
    input,
    "correlation-1",
  );
  const second = await service.createFileSession(
    ownerContext,
    input,
    "correlation-2",
  );

  assert.equal(first.session.status, "awaiting_upload");
  assert.equal(first.session.itemCount, 2);
  assert.equal(first.session.totalBytes, 12_288);
  assert.equal(first.items.every((item) => item.tenantId === "tenant-1"), true);
  assert.equal(second.session.id, first.session.id);
  assert.equal(store.bundles.length, 1);
  assert.equal(audits.events.length, 1);
  assert.equal(audits.events[0]?.action, "studio_import.session_created");
});

test("studio coordinators cannot create reusable studio imports", async () => {
  const service = new StudioImportService(
    new MemoryImportStore(),
    new MemoryImportAuditStore(),
    idFactory(),
    () => timestamp,
  );
  await assert.rejects(
    () =>
      service.createFileSession(
        { ...ownerContext, role: "studio_coordinator" },
        {
          idempotencyKey: "tenant-1|denied",
          files: [
            {
              clientId: "file-1",
              name: "contract.pdf",
              sizeBytes: 1024,
              contentType: "application/pdf",
              lastModifiedAt: timestamp,
            },
          ],
        },
        "correlation-denied",
      ),
    /permission/i,
  );
});

test("AI action authority boundaries prevent unsupported execution", () => {
  const base = {
    id: "ai-action-1",
    tenantId: "tenant-1",
    projectId: "project-1",
    actorId: "owner-1",
    capability: "contract_mapping",
    authorityBoundary: "human_approval_required",
    status: "approved",
    modelProvider: "vertex",
    modelVersion: "model-1",
    instructionVersion: "contract-map-1",
    outputSchemaVersion: "1",
    sourceReferences: [
      {
        entityType: "studioAssetVersion",
        entityId: "asset-version-1",
        versionId: "asset-version-1",
        label: "Wedding contract",
        locator: "page 1",
      },
    ],
    structuredOutput: { fields: [] },
    confidence: {
      overall: 0.92,
      label: "high",
      uncertainFields: [],
    },
    validation: { status: "passed", issues: [] },
    decision: {
      actorId: "owner-1",
      action: "approved",
      decidedAt: timestamp,
      note: null,
      editDelta: null,
    },
    downstreamCommand: null,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostMicros: 1500,
      latencyMs: 900,
      estimatedMinutesSaved: 20,
    },
    failure: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: "system",
    updatedBy: "owner-1",
    archivedAt: null,
  } as const;
  const approved = aiActionSchema.parse(base);
  assert.equal(aiActionMayExecute(approved), true);

  const insurance = aiActionSchema.parse({
    ...base,
    id: "ai-action-2",
    capability: "coi_extraction",
    authorityBoundary: "never_ai_authoritative",
  });
  assert.equal(aiActionMayExecute(insurance), false);

  const blocked = aiActionSchema.parse({
    ...base,
    id: "ai-action-3",
    validation: {
      status: "failed",
      issues: [
        {
          code: "UNSUPPORTED_TERM",
          severity: "blocking",
          message: "Legal language was not found in an approved source.",
          field: "terms",
        },
      ],
    },
  });
  assert.equal(aiActionMayExecute(blocked), false);
});

test("studio asset versions require traceable validation and approval fields", () => {
  const result = studioAssetVersionSchema.safeParse({
    id: "asset-version-1",
    tenantId: "tenant-1",
    assetId: "asset-1",
    importSessionId: "import-1",
    sourceItemIds: ["item-1"],
    assetType: "contract",
    name: "Wedding agreement",
    version: 1,
    status: "draft",
    structuredContent: { body: "Approved source content" },
    sourceCitations: [
      {
        itemId: "item-1",
        locator: "page 1",
        excerptHash: "a".repeat(64),
      },
    ],
    validation: { status: "passed", issues: [] },
    approvedBy: null,
    approvedAt: null,
    activatedAt: null,
    supersededAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: "owner-1",
    updatedBy: "owner-1",
    archivedAt: null,
  });
  assert.equal(result.success, true);
});

test("product events calculate non-negative verified time saved", () => {
  assert.equal(
    verifiedSecondsSaved({ baselineSeconds: 3600, activeSeconds: 900 }),
    2700,
  );
  assert.equal(
    verifiedSecondsSaved({ baselineSeconds: 300, activeSeconds: 600 }),
    0,
  );

  const event = productEventSchema.safeParse({
    id: "event-1",
    tenantId: "tenant-1",
    projectId: "project-1",
    actorId: "owner-1",
    actorType: "user",
    name: "handling.session_completed",
    occurredAt: timestamp,
    correlationId: "correlation-1",
    sourceEntityType: "project",
    sourceEntityId: "project-1",
    properties: { stage: "booking" },
    handling: {
      activeSeconds: 900,
      baselineSeconds: 3600,
      verifiedSecondsSaved: 2700,
      measurementMethod: "pilot_observation",
    },
  });
  assert.equal(event.success, true);
});

test("roadmap feature registry has unique keys and keeps future releases off", () => {
  const keys = roadmapFeatureRegistry.map((feature) => feature.key);
  assert.equal(new Set(keys).size, keys.length);
  const defaults = roadmapFeatureDefaults();
  assert.equal(defaults.studio_import_foundation, true);
  assert.equal(defaults.studio_import_processing, false);
  assert.equal(defaults.inquiry_booking_autopilot, false);
});

test("trusted import metadata and object paths are deterministic", () => {
  assert.deepEqual(
    validateStudioImportMetadata({
      name: "Wedding Contract.PDF",
      sizeBytes: 4096,
      contentType: "application/pdf",
    }),
    { extension: "pdf", contentType: "application/pdf" },
  );
  assert.equal(
    studioImportObjectPath({
      tenantId: "tenant-1",
      sessionId: "session-1",
      itemId: "item-1",
      uploadId: "upload-1",
      extension: "pdf",
    }),
    "tenants/tenant-1/studio-imports/session-1/item-1/upload-1/source.pdf",
  );
  assert.throws(
    () =>
      studioImportObjectPath({
        tenantId: "../tenant",
        sessionId: "session-1",
        itemId: "item-1",
        uploadId: "upload-1",
        extension: "pdf",
      }),
    /INVALID_STORAGE_PATH_PART/,
  );
});

test("file signatures must match the approved studio import type", () => {
  assert.equal(
    verifyStudioImportFileSignature(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      "pdf",
    ),
    true,
  );
  assert.equal(
    verifyStudioImportFileSignature(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]),
      "docx",
    ),
    true,
  );
  assert.equal(
    verifyStudioImportFileSignature(
      new TextEncoder().encode("client,package\nA,Wedding"),
      "csv",
    ),
    true,
  );
  assert.equal(
    verifyStudioImportFileSignature(
      new TextEncoder().encode("<script>alert(1)</script>"),
      "pdf",
    ),
    false,
  );
  assert.equal(
    verifyStudioImportFileSignature(
      new Uint8Array([0x00, 0x01, 0x02]),
      "txt",
    ),
    false,
  );
});
