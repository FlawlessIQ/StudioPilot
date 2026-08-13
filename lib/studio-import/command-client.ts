"use client";

import {
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getFirebaseClient } from "@/lib/firebase/client";
import { validateStudioImportFileCandidate } from "@/features/studio-import/schema";

export type StudioImportRemoteItem = {
  id: string;
  clientId: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  status: string;
  expectedObjectName: string | null;
  uploadId: string | null;
  retryCount: number;
  safety: Record<string, unknown> | null;
  classification?: Record<string, unknown> | null;
  draftVersionIds?: string[];
  duplicate?: Record<string, unknown> | null;
  failure: {
    code?: string;
    message?: string;
    retryable?: boolean;
  } | null;
};

export type StudioImportRemoteSession = {
  id: string;
  status: string;
  itemCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
};

export type StudioImportSessionResult = {
  session: StudioImportRemoteSession;
  items: StudioImportRemoteItem[];
};

export type StudioImportUploadProgress = {
  phase: "creating" | "uploading" | "scanning" | "ready" | "failed" | "cancelled";
  percent: number;
  message: string;
  sessionId: string | null;
  items: StudioImportRemoteItem[];
};

type CommandEnvelope = {
  type:
    | "createSession"
    | "createSourceSession"
    | "getSession"
    | "getReview"
    | "simulateSession"
    | "reviewDraft"
    | "splitDraft"
    | "mergeDrafts"
    | "activateSession"
    | "rollbackAsset"
    | "cancelSession"
    | "retryItem";
  tenantId: string;
  idempotencyKey: string;
  input: Record<string, unknown>;
};

let storageEmulatorConnected = false;

function endpoint() {
  return (
    process.env.NEXT_PUBLIC_STUDIO_IMPORT_FUNCTIONS_URL ??
    process.env.NEXT_PUBLIC_WORKFLOW_FUNCTIONS_URL
  );
}

async function command<T>(
  envelope: CommandEnvelope,
): Promise<T> {
  const baseUrl = endpoint();
  if (!baseUrl) throw new Error("STUDIO_IMPORT_PREVIEW_ONLY");
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before importing studio materials.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/studioImportCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken
          ? { "x-firebase-appcheck": appCheckToken }
          : {}),
      },
      body: JSON.stringify(envelope),
    },
  );
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    const friendlyErrors: Record<string, string> = {
      IMPORT_WEBSITE_URL_NOT_PUBLIC:
        "Use a public HTTPS page that does not require a login.",
      IMPORT_WEBSITE_FETCH_FAILED:
        "StudioCue could not open that page. Check the URL and try again.",
      IMPORT_WEBSITE_CONTENT_UNSUPPORTED:
        "That URL is not an HTML or text page that StudioCue can import.",
      IMPORT_WEBSITE_TOO_LARGE:
        "That page is too large to import safely. Upload a PDF or paste the relevant content instead.",
      IMPORT_WEBSITE_NO_READABLE_CONTENT:
        "StudioCue could not find readable content on that page. Upload a PDF or paste the content instead.",
      IMPORT_WEBSITE_TOO_MANY_REDIRECTS:
        "That page redirects too many times. Use its final public URL instead.",
      IMPORT_EMBEDDED_FORM_UNREADABLE:
        "That page contains a form embedded by another service, so StudioCue cannot safely read its fields. Export or print the form as a PDF and use Upload files instead.",
    };
    const error = typeof result.error === "string" ? result.error : "";
    throw new Error(
      friendlyErrors[error] ??
        (error ? error.replaceAll("_", " ").toLowerCase() : null) ??
        "Studio import could not be completed.",
    );
  }
  return result;
}

async function uploadFile(input: {
  file: File;
  item: StudioImportRemoteItem;
  tenantId: string;
  userId: string;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
}) {
  if (!input.item.expectedObjectName || !input.item.uploadId) {
    throw new Error("The secure upload path is missing.");
  }
  const client = getFirebaseClient();
  const storage = getStorage(client.app);
  if (
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
    !storageEmulatorConnected
  ) {
    try {
      connectStorageEmulator(storage, "127.0.0.1", 9199);
    } catch {
      // Another uploader may already have connected this shared app instance.
    }
    storageEmulatorConnected = true;
  }
  const task = uploadBytesResumable(
    ref(storage, input.item.expectedObjectName),
    input.file,
    {
      contentType: input.item.contentType,
      customMetadata: {
        scanStatus: "pending",
        visibility: "studio",
        tenantId: input.tenantId,
        importSessionId: input.item.expectedObjectName.split("/")[3] ?? "",
        importItemId: input.item.id,
        uploadId: input.item.uploadId,
        uploaderId: input.userId,
      },
    },
  );
  const cancel = () => task.cancel();
  input.signal?.addEventListener("abort", cancel, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      task.on(
        "state_changed",
        (snapshot) => {
          input.onProgress(
            snapshot.totalBytes > 0
              ? snapshot.bytesTransferred / snapshot.totalBytes
              : 0,
          );
        },
        reject,
        resolve,
      );
    });
  } finally {
    input.signal?.removeEventListener("abort", cancel);
  }
}

const activeSafetyStatuses = new Set([
  "awaiting_upload",
  "quarantined",
  "scanning",
]);
const cleanPipelineStatuses = new Set([
  "ready_for_analysis",
  "analyzing",
  "review_ready",
  "approved",
]);

export async function uploadStudioImportFiles(input: {
  files: readonly File[];
  signal?: AbortSignal;
  onProgress?: (progress: StudioImportUploadProgress) => void;
}): Promise<
  | { persisted: false }
  | { persisted: true; result: StudioImportSessionResult; ready: boolean }
> {
  if (!endpoint()) return { persisted: false };
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before importing studio materials.");
  const membership = await activeMembership(client.firestore, user.uid);
  const tenantId = String(membership.data().tenantId);
  const candidates = input.files.map((file) => {
    const clientId = `${file.name}-${file.size}-${file.lastModified}`;
    const validation = validateStudioImportFileCandidate({
      clientId,
      name: file.name,
      sizeBytes: file.size,
      contentType: file.type || "application/octet-stream",
      lastModifiedAt: new Date(file.lastModified).toISOString(),
    });
    if (!validation.accepted) throw new Error(validation.message);
    return validation.candidate;
  });
  input.onProgress?.({
    phase: "creating",
    percent: 2,
    message: "Creating a private import session…",
    sessionId: null,
    items: [],
  });
  const idempotencyKey = crypto.randomUUID();
  const created = await command<StudioImportSessionResult>({
    type: "createSession",
    tenantId,
    idempotencyKey,
    input: { files: candidates },
  });

  try {
    for (const [index, file] of input.files.entries()) {
      if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const clientId = `${file.name}-${file.size}-${file.lastModified}`;
      const item = created.items.find(
        (candidate) => candidate.clientId === clientId,
      );
      if (!item) throw new Error(`Import source was not created for ${file.name}.`);
      await uploadFile({
        file,
        item,
        tenantId,
        userId: user.uid,
        signal: input.signal,
        onProgress: (fraction) => {
          const overall =
            ((index + fraction) / Math.max(1, input.files.length)) * 70;
          input.onProgress?.({
            phase: "uploading",
            percent: Math.max(3, Math.round(overall)),
            message: `Uploading ${file.name} to private quarantine…`,
            sessionId: created.session.id,
            items: created.items,
          });
        },
      });
    }

    const startedAt = Date.now();
    let current = created;
    while (Date.now() - startedAt < 120_000) {
      if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      current = await command<StudioImportSessionResult>({
        type: "getSession",
        tenantId,
        idempotencyKey: crypto.randomUUID(),
        input: { sessionId: created.session.id },
      });
      const ready = current.items.every((item) =>
        cleanPipelineStatuses.has(item.status),
      );
      const active = current.items.some((item) =>
        activeSafetyStatuses.has(item.status),
      );
      const completed = current.items.filter(
        (item) =>
          cleanPipelineStatuses.has(item.status) ||
          item.status === "rejected" ||
          item.status === "failed",
      ).length;
      input.onProgress?.({
        phase: ready ? "ready" : active ? "scanning" : "failed",
        percent: ready
          ? 100
          : Math.min(
              96,
              72 +
                Math.round(
                  (completed / Math.max(1, current.items.length)) * 24,
                ),
            ),
        message: ready
          ? "Every source passed file-safety checks and entered AI analysis."
          : active
            ? "Verifying file signatures and scanning for malware…"
            : "One or more sources need attention.",
        sessionId: created.session.id,
        items: current.items,
      });
      if (ready || !active) {
        return { persisted: true, result: current, ready };
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    throw new Error("File safety checks are taking longer than expected.");
  } catch (caught: unknown) {
    if (input.signal?.aborted) {
      await command({
        type: "cancelSession",
        tenantId,
        idempotencyKey: crypto.randomUUID(),
        input: { sessionId: created.session.id },
      }).catch(() => undefined);
    }
    throw caught;
  }
}

export async function cancelStudioImport(sessionId: string): Promise<void> {
  if (!endpoint()) return;
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) return;
  const membership = await activeMembership(client.firestore, user.uid);
  await command({
    type: "cancelSession",
    tenantId: String(membership.data().tenantId),
    idempotencyKey: crypto.randomUUID(),
    input: { sessionId },
  });
}

export async function importStudioTextSource(input: {
  sourceType: "email_text" | "website";
  content?: string;
  url?: string;
  name: string;
  signal?: AbortSignal;
  onReview?: (review: StudioImportReview) => void;
}): Promise<
  | { persisted: false }
  | { persisted: true; result: StudioImportSessionResult; review: StudioImportReview }
> {
  if (!endpoint()) return { persisted: false };
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before importing studio materials.");
  const membership = await activeMembership(client.firestore, user.uid);
  const tenantId = String(membership.data().tenantId);
  const result = await command<StudioImportSessionResult>({
    type: "createSourceSession",
    tenantId,
    idempotencyKey: crypto.randomUUID(),
    input: {
      sourceType: input.sourceType,
      name: input.name,
      ...(input.content ? { content: input.content } : {}),
      ...(input.url ? { url: input.url } : {}),
    },
  });
  const review = await waitForStudioImportReview({
    sessionId: result.session.id,
    signal: input.signal,
    onReview: input.onReview,
  });
  return { persisted: true, result, review };
}

export async function retryStudioImportItem(input: {
  sessionId: string;
  itemId: string;
  file: File;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  onSafetyProgress?: (result: StudioImportSessionResult) => void;
}): Promise<{ result: StudioImportSessionResult; ready: boolean }> {
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before retrying an import.");
  const membership = await activeMembership(client.firestore, user.uid);
  const tenantId = String(membership.data().tenantId);
  const result = await command<{
    itemId: string;
    status: string;
    uploadId: string;
    expectedObjectName: string;
    retryCount: number;
  }>({
    type: "retryItem",
    tenantId,
    idempotencyKey: crypto.randomUUID(),
    input: { sessionId: input.sessionId, itemId: input.itemId },
  });
  await uploadFile({
    file: input.file,
    item: {
      id: result.itemId,
      clientId: `${input.file.name}-${input.file.size}-${input.file.lastModified}`,
      name: input.file.name,
      sizeBytes: input.file.size,
      contentType: input.file.type || "application/octet-stream",
      status: result.status,
      expectedObjectName: result.expectedObjectName,
      uploadId: result.uploadId,
      retryCount: result.retryCount,
      safety: null,
      failure: null,
    },
    tenantId,
    userId: user.uid,
    signal: input.signal,
    onProgress: input.onProgress ?? (() => undefined),
  });
  const startedAt = Date.now();
  let current: StudioImportSessionResult;
  while (Date.now() - startedAt < 120_000) {
    if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    current = await command<StudioImportSessionResult>({
      type: "getSession",
      tenantId,
      idempotencyKey: crypto.randomUUID(),
      input: { sessionId: input.sessionId },
    });
    input.onSafetyProgress?.(current);
    const ready = current.items.every((item) =>
      cleanPipelineStatuses.has(item.status),
    );
    const active = current.items.some((item) =>
      activeSafetyStatuses.has(item.status),
    );
    if (ready || !active) return { result: current, ready };
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error("File safety checks are taking longer than expected.");
}

export type StudioImportReviewDraft = {
  id: string;
  assetId: string;
  assetType: string;
  name: string;
  confidence: number;
  status: string;
  reviewDecision: string;
  structuredContent: Record<string, unknown>;
  sourceCitations: Array<{
    itemId?: string;
    locator?: string;
    excerpt?: string;
    excerptHash?: string;
  }>;
  validation: {
    status?: string;
    issues?: Array<{
      code?: string;
      severity?: string;
      message?: string;
    }>;
  };
  sourceItemIds: string[];
  updatedAt: string;
};

export type StudioImportReview = {
  session: {
    id: string;
    status: string;
    reviewReadyAt: string | null;
    approvedAt: string | null;
    activatedAt: string | null;
    activatedAssetVersionIds: string[];
  };
  sources: Array<{
    id: string;
    name: string;
    status: string;
    duplicate: Record<string, unknown> | null;
    classification: Record<string, unknown> | null;
    failure: Record<string, unknown> | null;
  }>;
  drafts: StudioImportReviewDraft[];
  coverage: {
    sections: Array<{
      key: string;
      label: string;
      matched: string[];
      expected: string[];
      complete: boolean;
    }>;
    completed: number;
    total: number;
    percent: number;
  };
};

async function studioImportEnvelope<T>(
  type: CommandEnvelope["type"],
  input: Record<string, unknown>,
): Promise<T> {
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before managing studio imports.");
  const membership = await activeMembership(client.firestore, user.uid);
  return command<T>({
    type,
    tenantId: String(membership.data().tenantId),
    idempotencyKey: crypto.randomUUID(),
    input,
  });
}

export async function getStudioImportReview(sessionId: string) {
  return studioImportEnvelope<StudioImportReview>("getReview", { sessionId });
}

export async function waitForStudioImportReview(input: {
  sessionId: string;
  signal?: AbortSignal;
  onReview?: (review: StudioImportReview) => void;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (input.signal?.aborted)
      throw new DOMException("Cancelled", "AbortError");
    const review = await getStudioImportReview(input.sessionId);
    input.onReview?.(review);
    const active = review.sources.some((source) =>
      ["ready_for_analysis", "analyzing"].includes(source.status),
    );
    if (!active) return review;
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error(
    "AI analysis did not finish within one minute. Nothing was activated—try again, or upload the source as a PDF for faster extraction.",
  );
}

export async function reviewStudioImportDraft(input: {
  sessionId: string;
  versionId: string;
  action: "approve" | "reject" | "ignore" | "update";
  name?: string;
  assetType?: string;
  structuredContent?: Record<string, unknown>;
  confirmClassification?: boolean;
}) {
  return studioImportEnvelope<{
    versionId: string;
    reviewDecision: string;
    validation: Record<string, unknown>;
  }>("reviewDraft", input);
}

export async function splitStudioImportDraft(input: {
  sessionId: string;
  versionId: string;
  parts: Array<{
    name: string;
    assetType: string;
    structuredContent: Record<string, unknown>;
  }>;
}) {
  return studioImportEnvelope("splitDraft", input);
}

export async function mergeStudioImportDrafts(input: {
  sessionId: string;
  targetVersionId: string;
  sourceVersionId: string;
}) {
  return studioImportEnvelope("mergeDrafts", input);
}

export async function simulateStudioImport(sessionId: string) {
  return studioImportEnvelope<{
    scenario: string;
    providerActionsExecuted: false;
    steps: Array<{
      stage: string;
      status: string;
      source: string | null;
      outcome: string;
      providerActionExecuted: false;
    }>;
  }>("simulateSession", { sessionId });
}

export async function activateStudioImport(sessionId: string) {
  return studioImportEnvelope<{
    sessionId: string;
    status: string;
    activatedAssetVersionIds: string[];
  }>("activateSession", { sessionId });
}

export async function rollbackStudioImportAsset(input: {
  assetId: string;
  targetVersionId: string;
}) {
  return studioImportEnvelope("rollbackAsset", input);
}
