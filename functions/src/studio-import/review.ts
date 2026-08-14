import { createHash } from "node:crypto";
import {
  getFirestore,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import {
  coverageForAssetTypes,
  sanitizeStructuredContent,
  simulateStudioImport,
  studioAssetTypes,
  validateExtractedAsset,
  type ExtractedStudioAsset,
  type StudioAssetType,
} from "./extraction.js";
import { productEvent } from "../operations/product-events.js";
import {
  importedDeliveryDefaults,
  importedMessageTemplate,
  importedReviewLink,
  importedStudioPackage,
} from "./native-assets.js";

type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const slug = (value: unknown, fallback: string): string =>
  string(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;

function importedQuestionnaireSections(contentValue: unknown) {
  const content = record(contentValue);
  const fields = Array.isArray(content.fields) ? content.fields : [];
  return [
    {
      id: "imported-section",
      title: "Project details",
      fields: fields.map((fieldValue, index) => {
        const field = record(fieldValue);
        const extractedType = string(field.type);
        const type =
          extractedType === "short_text"
            ? "text"
            : extractedType === "choice"
              ? "dropdown"
              : [
                    "text",
                    "long_text",
                    "email",
                    "phone",
                    "date",
                    "time",
                    "address",
                    "dropdown",
                    "multi_select",
                    "radio",
                    "checkbox",
                    "file",
                    "contact",
                    "repeating_group",
                    "acknowledgement",
                    "information",
                  ].includes(extractedType)
                ? extractedType
                : "text";
        return {
          id: slug(field.id ?? field.label, `field-${index + 1}`),
          label: string(field.label) || `Question ${index + 1}`,
          type,
          required: field.required === true,
          locked: false,
          internalOnly: false,
          options: Array.isArray(field.options)
            ? field.options.map(String).filter(Boolean)
            : [],
          conditionalOn:
            field.conditionalOn &&
            typeof field.conditionalOn === "object" &&
            !Array.isArray(field.conditionalOn)
              ? field.conditionalOn
              : null,
        };
      }),
    },
  ];
}

function importedTimingRule(contentValue: unknown, fallbackName: string) {
  const content = record(contentValue);
  const candidates = Array.isArray(content.timingRules)
    ? content.timingRules
    : [];
  const first =
    candidates.length > 0
      ? record(candidates[0])
      : Array.isArray(content.items) && content.items.length > 0
        ? record(content.items[0])
        : {};
  return {
    name: string(first.name ?? first.title) || fallbackName,
    eventTypeId: string(first.eventTypeId) || "wedding",
    anchor: string(first.anchor) || "event_start",
    offsetMinutes: Number(first.offsetMinutes ?? 0),
    durationMinutes: Math.max(1, Number(first.durationMinutes ?? 30)),
    bufferBeforeMinutes: Math.max(0, Number(first.bufferBeforeMinutes ?? 0)),
    bufferAfterMinutes: Math.max(0, Number(first.bufferAfterMinutes ?? 0)),
  };
}

async function sessionDocuments(
  db: Firestore,
  tenantId: string,
  sessionId: string,
) {
  const session = await db.doc(`studioImportSessions/${sessionId}`).get();
  if (!session.exists || session.get("tenantId") !== tenantId)
    throw new Error("IMPORT_SESSION_NOT_FOUND");
  const itemIds = Array.isArray(session.get("itemIds"))
    ? (session.get("itemIds") as unknown[]).map(String)
    : [];
  const items = await Promise.all(
    itemIds.map((itemId) => db.doc(`studioImportItems/${itemId}`).get()),
  );
  const versionIds = [
    ...new Set(
      items.flatMap((item) =>
        Array.isArray(item.get("draftVersionIds"))
          ? (item.get("draftVersionIds") as unknown[]).map(String)
          : [],
      ),
    ),
  ];
  const versions = await Promise.all(
    versionIds.map((versionId) =>
      db.doc(`studioAssetVersions/${versionId}`).get(),
    ),
  );
  return { session, items, versions: versions.filter((item) => item.exists) };
}

function reviewVersion(document: DocumentSnapshot) {
  return {
    id: document.id,
    assetId: string(document.get("assetId")),
    assetType: string(document.get("assetType")),
    name: string(document.get("name")),
    confidence: Number(document.get("confidence") ?? 0),
    status: string(document.get("status")),
    reviewDecision: string(document.get("reviewDecision") ?? "pending"),
    structuredContent: record(document.get("structuredContent")),
    sourceCitations: Array.isArray(document.get("sourceCitations"))
      ? document.get("sourceCitations")
      : [],
    validation: record(document.get("validation")),
    sourceItemIds: Array.isArray(document.get("sourceItemIds"))
      ? document.get("sourceItemIds")
      : [],
    updatedAt: string(document.get("updatedAt")),
  };
}

function hasBlockingValidationIssue(document: DocumentSnapshot) {
  const validation = record(document.get("validation"));
  const issues = Array.isArray(validation.issues) ? validation.issues : [];
  return issues.some(
    (issue) => string(record(issue).severity) === "blocking",
  );
}

function isUsableDraft(document: DocumentSnapshot) {
  return (
    document.get("status") !== "archived" &&
    !["split", "merged", "rejected", "ignored"].includes(
      string(document.get("reviewDecision")),
    ) &&
    !hasBlockingValidationIssue(document)
  );
}

export async function readStudioImportReview(
  tenantId: string,
  sessionId: string,
) {
  const db = getFirestore();
  const { session, items, versions } = await sessionDocuments(
    db,
    tenantId,
    sessionId,
  );
  const assetTypes = versions.filter(isUsableDraft).flatMap((version) => {
    const type = string(version.get("assetType"));
    return studioAssetTypes.includes(type as StudioAssetType)
      ? [type as StudioAssetType]
      : [];
  });
  const sources = await Promise.all(
    items.map(async (item) => {
      const duplicate = record(item.get("duplicate"));
      const duplicateItemId = string(duplicate.itemId);
      const base = {
        id: item.id,
        name: string(item.get("name")),
        status: string(item.get("status")),
        classification: item.get("classification") ?? null,
        failure: item.get("failure") ?? null,
      };
      const sha256 = string(item.get("sha256"));
      const activationLock = sha256
        ? await db.doc(
            `studioImportSourceActivations/${hash(`${tenantId}:${sha256}`)}`,
          ).get()
        : null;
      const activatedBySessionId = activationLock?.exists
        ? string(activationLock.get("sessionId"))
        : "";
      if (!duplicateItemId) {
        return {
          ...base,
          duplicate:
            activatedBySessionId && activatedBySessionId !== sessionId
              ? {
                  status: "activation_conflict",
                  sessionId: activatedBySessionId,
                  sessionStatus: "activated",
                  activationBlocked: true,
                }
              : null,
        };
      }
      const priorItem = await db.doc(`studioImportItems/${duplicateItemId}`).get();
      const priorSessionId = priorItem.exists
        ? string(priorItem.get("sessionId"))
        : "";
      const priorSession = await (
        priorSessionId
          ? db.doc(`studioImportSessions/${priorSessionId}`).get()
          : Promise.resolve(null)
      );
      const priorSessionStatus = priorSession?.exists
        ? string(priorSession.get("status"))
        : "unknown";
      return {
        ...base,
        duplicate: {
          ...duplicate,
          sessionId: priorSessionId || null,
          sessionStatus: priorSessionStatus,
          activationBlocked:
            (Boolean(activatedBySessionId) &&
              activatedBySessionId !== sessionId) ||
            priorSessionStatus === "activated",
        },
      };
    }),
  );
  return {
    session: {
      id: session.id,
      status: string(session.get("status")),
      reviewReadyAt: session.get("reviewReadyAt") ?? null,
      approvedAt: session.get("approvedAt") ?? null,
      activatedAt: session.get("activatedAt") ?? null,
      activatedAssetVersionIds:
        session.get("activatedAssetVersionIds") ?? [],
    },
    sources,
    drafts: versions.map(reviewVersion),
    coverage: coverageForAssetTypes(assetTypes),
  };
}

function extractedFromVersion(
  document: DocumentSnapshot,
  overrides: {
    name?: string;
    assetType?: string;
    structuredContent?: unknown;
    confirmClassification?: boolean;
  },
): ExtractedStudioAsset {
  const type = overrides.assetType ?? string(document.get("assetType"));
  if (!studioAssetTypes.includes(type as StudioAssetType))
    throw new Error("INVALID_ASSET_TYPE");
  const citations = Array.isArray(document.get("sourceCitations"))
    ? (document.get("sourceCitations") as unknown[]).flatMap((citation) => {
        const value = record(citation);
        const locator = string(value.locator);
        const excerpt = string(value.excerpt);
        return locator && excerpt ? [{ locator, excerpt }] : [];
      })
    : [];
  return {
    assetType: type as StudioAssetType,
    name: (overrides.name ?? string(document.get("name"))).trim(),
    confidence: overrides.confirmClassification
      ? 1
      : Number(document.get("confidence") ?? 0),
    structuredContent:
      overrides.structuredContent === undefined
        ? record(document.get("structuredContent"))
        : sanitizeStructuredContent(overrides.structuredContent),
    citations,
  };
}

function audit(input: {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  before: Json | null;
  after: Json | null;
}) {
  return {
    ...input,
    actorType: "user",
    ipAddress: null,
    userAgent: null,
    correlationId: input.id,
    automationRunId: null,
    providerEventId: null,
  };
}

export async function reviewStudioImportDraft(input: {
  tenantId: string;
  sessionId: string;
  versionId: string;
  actorId: string;
  action: "approve" | "reject" | "ignore" | "update";
  name?: string;
  assetType?: string;
  structuredContent?: unknown;
  confirmClassification?: boolean;
  executionId: string;
}) {
  const db = getFirestore();
  const now = new Date().toISOString();
  const sessionReference = db.doc(
    `studioImportSessions/${input.sessionId}`,
  );
  const versionReference = db.doc(
    `studioAssetVersions/${input.versionId}`,
  );
  return db.runTransaction(async (transaction) => {
    const [session, version, prior] = await Promise.all([
      transaction.get(sessionReference),
      transaction.get(versionReference),
      transaction.get(db.doc(`commandExecutions/${input.executionId}`)),
    ]);
    if (prior.exists) return prior.get("result");
    if (!session.exists || session.get("tenantId") !== input.tenantId)
      throw new Error("IMPORT_SESSION_NOT_FOUND");
    if (
      !version.exists ||
      version.get("tenantId") !== input.tenantId ||
      version.get("importSessionId") !== input.sessionId
    )
      throw new Error("IMPORT_DRAFT_NOT_FOUND");
    if (
      ["active", "superseded", "archived"].includes(
        string(version.get("status")),
      )
    )
      throw new Error("IMPORT_DRAFT_IMMUTABLE");

    const asset = extractedFromVersion(version, input);
    const issues = validateExtractedAsset(asset);
    const blocking = issues.filter((issue) => issue.severity === "blocking");
    if (input.action === "approve" && blocking.length)
      throw new Error("IMPORT_DRAFT_HAS_BLOCKING_ISSUES");
    const decision =
      input.action === "update"
        ? "pending"
        : input.action === "ignore"
          ? "ignored"
          : input.action === "reject"
            ? "rejected"
            : "approved";
    const nextStatus =
      input.action === "ignore"
        ? "archived"
        : input.action === "approve"
          ? "draft"
          : "draft";
    transaction.update(versionReference, {
      name: asset.name,
      assetType: asset.assetType,
      confidence: asset.confidence,
      structuredContent: asset.structuredContent,
      validation: {
        status: blocking.length ? "failed" : "passed",
        issues,
      },
      reviewDecision: decision,
      status: nextStatus,
      approvedBy: input.action === "approve" ? input.actorId : null,
      approvedAt: input.action === "approve" ? now : null,
      archivedAt: input.action === "ignore" ? now : null,
      updatedAt: now,
      updatedBy: input.actorId,
    });
    const result = {
      versionId: input.versionId,
      reviewDecision: decision,
      validation: {
        status: blocking.length ? "failed" : "passed",
        issues,
      },
    };
    transaction.create(db.doc(`commandExecutions/${input.executionId}`), {
      id: input.executionId,
      tenantId: input.tenantId,
      type: `studioImport.${input.action}`,
      status: "succeeded",
      result,
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(db.doc(`auditEvents/${input.executionId}`), audit({
      id: input.executionId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: `studio_import.draft_${input.action}`,
      entityType: "studioAssetVersion",
      entityId: input.versionId,
      timestamp: now,
      before: {
        reviewDecision: string(version.get("reviewDecision")),
        status: string(version.get("status")),
      },
      after: {
        reviewDecision: decision,
        status: nextStatus,
      },
    }));
    return result;
  });
}

export async function splitStudioImportDraft(input: {
  tenantId: string;
  sessionId: string;
  versionId: string;
  actorId: string;
  parts: Array<{
    name: string;
    assetType: StudioAssetType;
    structuredContent: Json;
  }>;
  executionId: string;
}) {
  const db = getFirestore();
  const now = new Date().toISOString();
  const source = await db
    .doc(`studioAssetVersions/${input.versionId}`)
    .get();
  if (
    !source.exists ||
    source.get("tenantId") !== input.tenantId ||
    source.get("importSessionId") !== input.sessionId
  )
    throw new Error("IMPORT_DRAFT_NOT_FOUND");
  const session = await db
    .doc(`studioImportSessions/${input.sessionId}`)
    .get();
  if (!session.exists || session.get("tenantId") !== input.tenantId)
    throw new Error("IMPORT_SESSION_NOT_FOUND");
  const ids = input.parts.map(
    (_part, index) =>
      `asset_version_${hash(
        `${input.versionId}:split:${index}:${input.executionId}`,
      ).slice(0, 32)}`,
  );
  const batch = db.batch();
  input.parts.forEach((part, index) => {
    const asset: ExtractedStudioAsset = {
      ...part,
      confidence: 1,
      citations: Array.isArray(source.get("sourceCitations"))
        ? (source.get("sourceCitations") as unknown[]).flatMap((citation) => {
            const value = record(citation);
            return string(value.locator) && string(value.excerpt)
              ? [
                  {
                    locator: string(value.locator),
                    excerpt: string(value.excerpt),
                  },
                ]
              : [];
          })
        : [],
    };
    const issues = validateExtractedAsset(asset);
    const id = ids[index];
    if (!id) return;
    batch.create(db.doc(`studioAssetVersions/${id}`), {
      ...source.data(),
      id,
      assetId: `asset_${hash(
        `${input.tenantId}:${part.assetType}:${part.name.toLowerCase()}`,
      ).slice(0, 32)}`,
      assetType: part.assetType,
      name: part.name,
      structuredContent: part.structuredContent,
      confidence: 1,
      validation: {
        status: issues.some((issue) => issue.severity === "blocking")
          ? "failed"
          : "passed",
        issues,
      },
      reviewDecision: "pending",
      approvedBy: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    });
  });
  batch.update(source.ref, {
    status: "archived",
    reviewDecision: "split",
    splitIntoVersionIds: ids,
    archivedAt: now,
    updatedAt: now,
    updatedBy: input.actorId,
  });
  for (const sourceItemId of Array.isArray(source.get("sourceItemIds"))
    ? (source.get("sourceItemIds") as unknown[]).map(String)
    : []) {
    const itemReference = db.doc(`studioImportItems/${sourceItemId}`);
    const item = await itemReference.get();
    const existing = Array.isArray(item.get("draftVersionIds"))
      ? (item.get("draftVersionIds") as unknown[]).map(String)
      : [];
    batch.update(itemReference, {
      draftVersionIds: [
        ...existing.filter((id) => id !== input.versionId),
        ...ids,
      ],
      updatedAt: now,
      updatedBy: input.actorId,
    });
  }
  batch.create(db.doc(`commandExecutions/${input.executionId}`), {
    id: input.executionId,
    tenantId: input.tenantId,
    type: "studioImport.split",
    status: "succeeded",
    result: { sourceVersionId: input.versionId, versionIds: ids },
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();
  return { sourceVersionId: input.versionId, versionIds: ids };
}

export async function mergeStudioImportDrafts(input: {
  tenantId: string;
  sessionId: string;
  targetVersionId: string;
  sourceVersionId: string;
  actorId: string;
  executionId: string;
}) {
  const db = getFirestore();
  const [target, source] = await Promise.all([
    db.doc(`studioAssetVersions/${input.targetVersionId}`).get(),
    db.doc(`studioAssetVersions/${input.sourceVersionId}`).get(),
  ]);
  for (const version of [target, source]) {
    if (
      !version.exists ||
      version.get("tenantId") !== input.tenantId ||
      version.get("importSessionId") !== input.sessionId
    )
      throw new Error("IMPORT_DRAFT_NOT_FOUND");
  }
  if (target.get("assetType") !== source.get("assetType"))
    throw new Error("IMPORT_DRAFT_TYPE_CONFLICT");
  const now = new Date().toISOString();
  const content = {
    ...record(target.get("structuredContent")),
    ...record(source.get("structuredContent")),
  };
  const citations = [
    ...(Array.isArray(target.get("sourceCitations"))
      ? (target.get("sourceCitations") as unknown[])
      : []),
    ...(Array.isArray(source.get("sourceCitations"))
      ? (source.get("sourceCitations") as unknown[])
      : []),
  ];
  const batch = db.batch();
  batch.update(target.ref, {
    structuredContent: content,
    sourceCitations: citations,
    sourceItemIds: [
      ...new Set(
        [
          ...(Array.isArray(target.get("sourceItemIds"))
            ? (target.get("sourceItemIds") as unknown[])
            : []),
          ...(Array.isArray(source.get("sourceItemIds"))
            ? (source.get("sourceItemIds") as unknown[])
            : []),
        ].map(String),
      ),
    ],
    confidence: 1,
    reviewDecision: "pending",
    updatedAt: now,
    updatedBy: input.actorId,
  });
  batch.update(source.ref, {
    status: "archived",
    reviewDecision: "merged",
    mergedIntoVersionId: input.targetVersionId,
    archivedAt: now,
    updatedAt: now,
    updatedBy: input.actorId,
  });
  batch.create(db.doc(`commandExecutions/${input.executionId}`), {
    id: input.executionId,
    tenantId: input.tenantId,
    type: "studioImport.merge",
    status: "succeeded",
    result: {
      targetVersionId: input.targetVersionId,
      sourceVersionId: input.sourceVersionId,
    },
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();
  return {
    targetVersionId: input.targetVersionId,
    sourceVersionId: input.sourceVersionId,
  };
}

export async function activateStudioImport(input: {
  tenantId: string;
  sessionId: string;
  actorId: string;
  executionId: string;
}) {
  const db = getFirestore();
  const { session, items, versions } = await sessionDocuments(
    db,
    input.tenantId,
    input.sessionId,
  );
  if (session.get("status") === "activated") {
    const activatedIds = new Set(
      Array.isArray(session.get("activatedAssetVersionIds"))
        ? (session.get("activatedAssetVersionIds") as unknown[]).map(String)
        : [],
    );
    const activatedPackages = versions.filter(
      (version) =>
        version.get("assetType") === "package" &&
        version.get("status") === "active" &&
        (activatedIds.size === 0 || activatedIds.has(version.id)),
    );
    if (activatedPackages.length) {
      const now = new Date().toISOString();
      const batch = db.batch();
      activatedPackages.forEach((version, index) => {
        const assetId = string(version.get("assetId"));
        const packageId = `imported_package_${assetId}`;
        batch.set(
          db.doc(`packages/${packageId}`),
          {
            id: packageId,
            tenantId: input.tenantId,
            ...importedStudioPackage({
              name: string(version.get("name")) || "Imported package",
              structuredContent: version.get("structuredContent"),
              displayOrder: index,
            }),
            version: Number(version.get("version") ?? 1),
            sourceStudioAssetId: assetId,
            sourceStudioAssetVersionId: version.id,
            createdAt: string(version.get("createdAt")) || now,
            updatedAt: now,
            createdBy: string(version.get("createdBy")) || input.actorId,
            updatedBy: input.actorId,
            archivedAt: null,
          },
          { merge: true },
        );
      });
      await batch.commit();
    }
    return {
      sessionId: input.sessionId,
      status: "activated",
      activatedAssetVersionIds: [...activatedIds],
      repairedNativePackageCount: activatedPackages.length,
    };
  }
  const approved = versions.filter(
    (version) =>
      version.get("reviewDecision") === "approved" &&
      version.get("validation.status") === "passed" &&
      version.get("status") === "draft",
  );
  if (!approved.length) throw new Error("NO_APPROVED_IMPORT_DRAFTS");
  const assetIds = approved.map((version) => string(version.get("assetId")));
  if (new Set(assetIds).size !== assetIds.length)
    throw new Error("DUPLICATE_APPROVED_ASSET_CONFLICT");
  const assets = await Promise.all(
    assetIds.map((assetId) => db.doc(`studioAssets/${assetId}`).get()),
  );
  const activeVersionIds = assets.flatMap((asset) =>
    asset.exists && string(asset.get("activeVersionId"))
      ? [string(asset.get("activeVersionId"))]
      : [],
  );
  const activeVersions = await Promise.all(
    activeVersionIds.map((versionId) =>
      db.doc(`studioAssetVersions/${versionId}`).get(),
    ),
  );
  const approvedSourceItemIds = new Set(
    approved.flatMap((version) =>
      Array.isArray(version.get("sourceItemIds"))
        ? (version.get("sourceItemIds") as unknown[]).map(String)
        : [],
    ),
  );
  const sourceLocks = items.flatMap((item) => {
    const sha256 = string(item.get("sha256"));
    if (!approvedSourceItemIds.has(item.id) || !sha256) return [];
    return [{
      item,
      reference: db.doc(
        `studioImportSourceActivations/${hash(`${input.tenantId}:${sha256}`)}`,
      ),
    }];
  });
  const duplicateItemIds = [
    ...new Set(
      items.flatMap((item) => {
        const duplicateItemId = string(record(item.get("duplicate")).itemId);
        return duplicateItemId ? [duplicateItemId] : [];
      }),
    ),
  ];
  const duplicateItems = await Promise.all(
    duplicateItemIds.map((itemId) =>
      db.doc(`studioImportItems/${itemId}`).get(),
    ),
  );
  const duplicateSessionIds = [
    ...new Set(
      duplicateItems.flatMap((item) => {
        const duplicateSessionId = string(item.get("sessionId"));
        return duplicateSessionId && duplicateSessionId !== input.sessionId
          ? [duplicateSessionId]
          : [];
      }),
    ),
  ];
  const now = new Date().toISOString();
  const result = await db.runTransaction(async (transaction) => {
    const prior = await transaction.get(
      db.doc(`commandExecutions/${input.executionId}`),
    );
    if (prior.exists) return prior.get("result");
    const currentSession = await transaction.get(session.ref);
    if (currentSession.get("status") === "activated")
      return {
        sessionId: input.sessionId,
        status: "activated",
        activatedAssetVersionIds:
          currentSession.get("activatedAssetVersionIds") ?? [],
      };
    const [existingLocks, duplicateSessions] = await Promise.all([
      Promise.all(
        sourceLocks.map(({ reference }) => transaction.get(reference)),
      ),
      Promise.all(
        duplicateSessionIds.map((duplicateSessionId) =>
          transaction.get(db.doc(`studioImportSessions/${duplicateSessionId}`)),
        ),
      ),
    ]);
    if (
      existingLocks.some(
        (lock) =>
          lock.exists && string(lock.get("sessionId")) !== input.sessionId,
      ) ||
      duplicateSessions.some(
        (duplicateSession) =>
          duplicateSession.exists &&
          duplicateSession.get("status") === "activated",
      )
    ) {
      throw new Error("DUPLICATE_IMPORT_SOURCE_ALREADY_ACTIVATED");
    }
    approved.forEach((version, index) => {
      const asset = assets[index];
      if (!asset) return;
      const nextVersion = asset.exists
        ? Number(asset.get("latestVersion") ?? 0) + 1
        : 1;
      if (asset.exists && string(asset.get("activeVersionId"))) {
        const active = activeVersions.find(
          (candidate) =>
            candidate.id === string(asset.get("activeVersionId")),
        );
        if (active?.exists) {
          transaction.update(active.ref, {
            status: "superseded",
            supersededAt: now,
            updatedAt: now,
            updatedBy: input.actorId,
          });
        }
      }
      transaction.set(
        db.doc(`studioAssets/${string(version.get("assetId"))}`),
        {
          id: string(version.get("assetId")),
          tenantId: input.tenantId,
          assetType: version.get("assetType"),
          name: version.get("name"),
          activeVersionId: version.id,
          latestVersion: nextVersion,
          createdAt: asset.exists ? asset.get("createdAt") : now,
          updatedAt: now,
          createdBy: asset.exists ? asset.get("createdBy") : input.actorId,
          updatedBy: input.actorId,
          archivedAt: null,
        },
        { merge: true },
      );
      transaction.update(version.ref, {
        version: nextVersion,
        status: "active",
        activatedAt: now,
        updatedAt: now,
        updatedBy: input.actorId,
      });
      const assetType = string(version.get("assetType"));
      const assetId = string(version.get("assetId"));
      if (assetType === "package") {
        const packageId = `imported_package_${assetId}`;
        transaction.set(
          db.doc(`packages/${packageId}`),
          {
            id: packageId,
            tenantId: input.tenantId,
            ...importedStudioPackage({
              name: string(version.get("name")) || "Imported package",
              structuredContent: version.get("structuredContent"),
              displayOrder: index,
            }),
            version: nextVersion,
            sourceStudioAssetId: assetId,
            sourceStudioAssetVersionId: version.id,
            createdAt: asset.exists ? asset.get("createdAt") : now,
            updatedAt: now,
            createdBy: asset.exists ? asset.get("createdBy") : input.actorId,
            updatedBy: input.actorId,
            archivedAt: null,
          },
          { merge: true },
        );
      }
      if (assetType === "questionnaire") {
        const templateId = `imported_questionnaire_${assetId}`;
        transaction.set(
          db.doc(`questionnaireTemplates/${templateId}`),
          {
            id: templateId,
            tenantId: input.tenantId,
            name: version.get("name"),
            eventTypeId: "wedding",
            version: nextVersion,
            status: "active",
            sections: importedQuestionnaireSections(
              version.get("structuredContent"),
            ),
            dueDaysBeforeEvent: 60,
            reminderDaysBeforeDue: [7, 3, 1],
            sourceStudioAssetId: assetId,
            sourceStudioAssetVersionId: version.id,
            createdAt: asset.exists ? asset.get("createdAt") : now,
            updatedAt: now,
            createdBy: asset.exists ? asset.get("createdBy") : input.actorId,
            updatedBy: input.actorId,
            archivedAt: null,
          },
          { merge: true },
        );
      }
      if (assetType === "timing_rule") {
        const ruleId = `imported_timing_${assetId}`;
        transaction.set(
          db.doc(`timingRules/${ruleId}`),
          {
            id: ruleId,
            tenantId: input.tenantId,
            ...importedTimingRule(
              version.get("structuredContent"),
              string(version.get("name")) || "Imported timing rule",
            ),
            active: true,
            version: nextVersion,
            source: "import",
            sourceStudioAssetId: assetId,
            sourceStudioAssetVersionId: version.id,
            approvedAt: now,
            approvedBy: input.actorId,
            createdAt: asset.exists ? asset.get("createdAt") : now,
            updatedAt: now,
            createdBy: asset.exists ? asset.get("createdBy") : input.actorId,
            updatedBy: input.actorId,
            archivedAt: null,
          },
          { merge: true },
        );
      }
      if (assetType === "message_template") {
        const template = importedMessageTemplate({
          name: string(version.get("name")) || "Imported message",
          structuredContent: version.get("structuredContent"),
        });
        const templateId = `imported_message_${assetId}_v${nextVersion}`;
        transaction.set(
          db.doc(`messageTemplates/${templateId}`),
          {
            id: templateId,
            tenantId: input.tenantId,
            ...template,
            version: nextVersion,
            status: "draft",
            sourceStudioAssetId: assetId,
            sourceStudioAssetVersionId: version.id,
            createdAt: asset.exists ? asset.get("createdAt") : now,
            updatedAt: now,
            createdBy: asset.exists ? asset.get("createdBy") : input.actorId,
            updatedBy: input.actorId,
          },
          { merge: true },
        );
      }
      if (assetType === "delivery_instruction") {
        const defaults = importedDeliveryDefaults(
          version.get("structuredContent"),
        );
        if (Object.keys(defaults).length) {
          transaction.update(db.doc(`tenants/${input.tenantId}`), {
            ...defaults,
            updatedAt: now,
            updatedBy: input.actorId,
          });
        }
      }
      if (assetType === "review_request") {
        const reviewLink = importedReviewLink(
          version.get("structuredContent"),
        );
        if (reviewLink) {
          transaction.update(db.doc(`tenants/${input.tenantId}`), {
            [`reviewLinks.${reviewLink.field}`]: reviewLink.url,
            updatedAt: now,
            updatedBy: input.actorId,
          });
        }
      }
    });
    sourceLocks.forEach(({ item, reference }) => {
      transaction.set(reference, {
        tenantId: input.tenantId,
        sha256: string(item.get("sha256")),
        sourceItemId: item.id,
        sessionId: input.sessionId,
        activatedAt: now,
        activatedBy: input.actorId,
      });
    });
    const value = {
      sessionId: input.sessionId,
      status: "activated",
      activatedAssetVersionIds: approved.map((version) => version.id),
    };
    transaction.update(session.ref, {
      status: "activated",
      approvedItemIds: [
        ...new Set(
          approved.flatMap((version) =>
            Array.isArray(version.get("sourceItemIds"))
              ? (version.get("sourceItemIds") as unknown[]).map(String)
              : [],
          ),
        ),
      ],
      ignoredItemIds: versions
        .filter((version) =>
          ["ignored", "rejected"].includes(
            string(version.get("reviewDecision")),
          ),
        )
        .flatMap((version) =>
          Array.isArray(version.get("sourceItemIds"))
            ? (version.get("sourceItemIds") as unknown[]).map(String)
            : [],
        ),
      activatedAssetVersionIds: value.activatedAssetVersionIds,
      approvedAt: now,
      activatedAt: now,
      updatedAt: now,
      updatedBy: input.actorId,
    });
    transaction.create(db.doc(`commandExecutions/${input.executionId}`), {
      id: input.executionId,
      tenantId: input.tenantId,
      type: "studioImport.activate",
      status: "succeeded",
      result: value,
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(db.doc(`auditEvents/${input.executionId}`), audit({
      id: input.executionId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: "studio_import.session_activated",
      entityType: "studioImportSession",
      entityId: input.sessionId,
      timestamp: now,
      before: { status: string(session.get("status")) },
      after: {
        status: "activated",
        activatedAssetVersionIds: value.activatedAssetVersionIds,
      },
    }));
    const event = productEvent({
      tenantId: input.tenantId,
      actorId: input.actorId,
      name: "studio_import.activated",
      occurredAt: now,
      correlationId: input.executionId,
      sourceEntityType: "studioImportSession",
      sourceEntityId: input.sessionId,
      properties: {
        activatedAssetCount: value.activatedAssetVersionIds.length,
        activatedAssetVersionIds: value.activatedAssetVersionIds,
      },
    });
    transaction.create(db.doc(`productEvents/${event.id}`), event);
    return value;
  });
  return result;
}

export async function simulateStudioImportSession(
  tenantId: string,
  sessionId: string,
) {
  const { versions } = await sessionDocuments(
    getFirestore(),
    tenantId,
    sessionId,
  );
  return simulateStudioImport(
    versions
      .filter((version) =>
        ["approved", "pending"].includes(
          string(version.get("reviewDecision")),
        ),
      )
      .flatMap((version) => {
        const assetType = string(version.get("assetType"));
        return studioAssetTypes.includes(assetType as StudioAssetType)
          ? [
              {
                assetType: assetType as StudioAssetType,
                name: string(version.get("name")),
              },
            ]
          : [];
      }),
  );
}

export async function rollbackStudioAsset(input: {
  tenantId: string;
  assetId: string;
  targetVersionId: string;
  actorId: string;
  executionId: string;
}) {
  const db = getFirestore();
  const assetReference = db.doc(`studioAssets/${input.assetId}`);
  const targetReference = db.doc(
    `studioAssetVersions/${input.targetVersionId}`,
  );
  const now = new Date().toISOString();
  return db.runTransaction(async (transaction) => {
    const [asset, target, prior] = await Promise.all([
      transaction.get(assetReference),
      transaction.get(targetReference),
      transaction.get(db.doc(`commandExecutions/${input.executionId}`)),
    ]);
    if (prior.exists) return prior.get("result");
    if (!asset.exists || asset.get("tenantId") !== input.tenantId)
      throw new Error("STUDIO_ASSET_NOT_FOUND");
    if (
      !target.exists ||
      target.get("tenantId") !== input.tenantId ||
      target.get("assetId") !== input.assetId ||
      !["active", "superseded"].includes(string(target.get("status")))
    )
      throw new Error("ROLLBACK_VERSION_NOT_FOUND");
    const currentVersionId = string(asset.get("activeVersionId"));
    if (currentVersionId === input.targetVersionId)
      return {
        assetId: input.assetId,
        activeVersionId: input.targetVersionId,
      };
    const current = await transaction.get(
      db.doc(`studioAssetVersions/${currentVersionId}`),
    );
    if (current.exists) {
      transaction.update(current.ref, {
        status: "superseded",
        supersededAt: now,
        updatedAt: now,
        updatedBy: input.actorId,
      });
    }
    transaction.update(targetReference, {
      status: "active",
      activatedAt: now,
      supersededAt: null,
      updatedAt: now,
      updatedBy: input.actorId,
    });
    transaction.update(assetReference, {
      activeVersionId: input.targetVersionId,
      updatedAt: now,
      updatedBy: input.actorId,
    });
    const targetAssetType = string(target.get("assetType"));
    if (targetAssetType === "questionnaire") {
      const templateId = `imported_questionnaire_${input.assetId}`;
      transaction.set(
        db.doc(`questionnaireTemplates/${templateId}`),
        {
          id: templateId,
          tenantId: input.tenantId,
          name: target.get("name"),
          eventTypeId: "wedding",
          version: Number(target.get("version") ?? 1),
          status: "active",
          sections: importedQuestionnaireSections(
            target.get("structuredContent"),
          ),
          dueDaysBeforeEvent: 60,
          reminderDaysBeforeDue: [7, 3, 1],
          sourceStudioAssetId: input.assetId,
          sourceStudioAssetVersionId: target.id,
          updatedAt: now,
          updatedBy: input.actorId,
          archivedAt: null,
        },
        { merge: true },
      );
    }
    if (targetAssetType === "timing_rule") {
      const ruleId = `imported_timing_${input.assetId}`;
      transaction.set(
        db.doc(`timingRules/${ruleId}`),
        {
          id: ruleId,
          tenantId: input.tenantId,
          ...importedTimingRule(
            target.get("structuredContent"),
            string(target.get("name")) || "Imported timing rule",
          ),
          active: true,
          version: Number(target.get("version") ?? 1),
          source: "import",
          sourceStudioAssetId: input.assetId,
          sourceStudioAssetVersionId: target.id,
          approvedAt: now,
          approvedBy: input.actorId,
          updatedAt: now,
          updatedBy: input.actorId,
          archivedAt: null,
        },
        { merge: true },
      );
    }
    if (targetAssetType === "message_template") {
      const version = Number(target.get("version") ?? 1);
      const template = importedMessageTemplate({
        name: string(target.get("name")) || "Imported message",
        structuredContent: target.get("structuredContent"),
      });
      const templateId = `imported_message_${input.assetId}_v${version}`;
      transaction.set(
        db.doc(`messageTemplates/${templateId}`),
        {
          id: templateId,
          tenantId: input.tenantId,
          ...template,
          version,
          status: "draft",
          sourceStudioAssetId: input.assetId,
          sourceStudioAssetVersionId: target.id,
          updatedAt: now,
          updatedBy: input.actorId,
        },
        { merge: true },
      );
    }
    if (targetAssetType === "delivery_instruction") {
      const defaults = importedDeliveryDefaults(
        target.get("structuredContent"),
      );
      if (Object.keys(defaults).length) {
        transaction.update(db.doc(`tenants/${input.tenantId}`), {
          ...defaults,
          updatedAt: now,
          updatedBy: input.actorId,
        });
      }
    }
    if (targetAssetType === "review_request") {
      const reviewLink = importedReviewLink(
        target.get("structuredContent"),
      );
      if (reviewLink) {
        transaction.update(db.doc(`tenants/${input.tenantId}`), {
          [`reviewLinks.${reviewLink.field}`]: reviewLink.url,
          updatedAt: now,
          updatedBy: input.actorId,
        });
      }
    }
    const result = {
      assetId: input.assetId,
      activeVersionId: input.targetVersionId,
      rolledBackFromVersionId: currentVersionId,
    };
    transaction.create(db.doc(`commandExecutions/${input.executionId}`), {
      id: input.executionId,
      tenantId: input.tenantId,
      type: "studioImport.rollback",
      status: "succeeded",
      result,
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(db.doc(`auditEvents/${input.executionId}`), audit({
      id: input.executionId,
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: "studio_asset.version_rolled_back",
      entityType: "studioAsset",
      entityId: input.assetId,
      timestamp: now,
      before: { activeVersionId: currentVersionId },
      after: { activeVersionId: input.targetVersionId },
    }));
    const event = productEvent({
      tenantId: input.tenantId,
      actorId: input.actorId,
      name: "studio_import.rolled_back",
      occurredAt: now,
      correlationId: input.executionId,
      sourceEntityType: "studioAsset",
      sourceEntityId: input.assetId,
      properties: {
        fromVersionId: currentVersionId,
        targetVersionId: input.targetVersionId,
      },
    });
    transaction.create(db.doc(`productEvents/${event.id}`), event);
    return result;
  });
}
