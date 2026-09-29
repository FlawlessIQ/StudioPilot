"use client";

import { doc, getDoc } from "firebase/firestore";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, type FirebaseStorage } from "firebase/storage";
import { getFirebaseClient } from "@/lib/firebase/client";
import { fileKindOf, type FileRef } from "@/features/documents/file-ref";

/**
 * A file ref, as a URL the browser can open.
 *
 * The one place a path becomes a link (docs/document-access-plan-2026-09-28.md):
 * lifted out of the documents viewer and merged with the contract signed-copy
 * helper, so swapping `getDownloadURL` for short-lived signed URLs later is a
 * change here and nowhere else.
 *
 * `getDownloadURL` goes through the Storage rules as whoever is signed in, and
 * returns a token URL. That is acceptable for a studio opening its own files;
 * the rules already let owners, admins and coordinators read a project's files
 * once scanned clean.
 */
export type ResolvedFile =
  | { status: "ready"; url: string; name: string; contentType: string | null; sizeBytes: number | null }
  | { status: "pending"; name: string; message: string }
  | { status: "error"; name: string; message: string };

let emulatorConnected = false;

export function studioStorage(): FirebaseStorage {
  const client = getFirebaseClient();
  const storage = getStorage(client.app);
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && !emulatorConnected) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    emulatorConnected = true;
  }
  return storage;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function storageFailure(caught: unknown, name: string): ResolvedFile {
  const code = typeof caught === "object" && caught && "code" in caught ? String((caught as { code: unknown }).code) : "";
  // The rules hold a file back until it has been scanned. A file someone just
  // uploaded reads as "not allowed" for a minute — that is "still being
  // checked", not "broken". (The `scanStatus` copied into questionnaire answers
  // is never updated after the scan, so it can't be asked instead.)
  if (code === "storage/unauthorized") {
    return {
      status: "pending",
      name,
      message: "This file is still being checked. Try again in a minute.",
    };
  }
  if (code === "storage/object-not-found") {
    return { status: "error", name, message: "This file isn't there any more — it may have been replaced." };
  }
  return { status: "error", name, message: "This file couldn't be opened. Try again in a moment." };
}

async function fromPath(path: string, name: string, contentType: string | null, sizeBytes: number | null): Promise<ResolvedFile> {
  try {
    const url = await getDownloadURL(ref(studioStorage(), path));
    return { status: "ready", url, name, contentType, sizeBytes };
  } catch (caught) {
    return storageFailure(caught, name);
  }
}

/** A `documents` record's own file: a ready URL, or a path to resolve. */
async function fromDocument(id: string, label: string, tenantId: string | null): Promise<ResolvedFile> {
  const { firestore } = getFirebaseClient();
  let snapshot;
  try {
    snapshot = await getDoc(doc(firestore, "documents", id));
  } catch {
    return { status: "error", name: label, message: "This file isn't available to you." };
  }
  if (!snapshot.exists() || (tenantId && snapshot.get("tenantId") !== tenantId)) {
    return { status: "error", name: label, message: "This file isn't available in this studio." };
  }
  const data = snapshot.data() as Record<string, unknown>;
  const name = text(data.name) || text(data.fileName) || label;
  const contentType = text(data.contentType) || null;
  const sizeBytes = typeof data.sizeBytes === "number" ? data.sizeBytes : null;
  const direct = text(data.downloadUrl) || text(data.url) || text(data.fileUrl);
  if (/^https?:\/\//i.test(direct)) return { status: "ready", url: direct, name, contentType, sizeBytes };
  const path =
    text(data.storagePath) || text(data.providerFileId) || text(data.canonicalPath) || text(data.filePath);
  if (!path) return { status: "pending", name, message: "No file is attached to this document yet." };
  return fromPath(path, name, contentType, sizeBytes);
}

export async function resolveFile(file: FileRef, tenantId: string | null): Promise<ResolvedFile> {
  if (file.kind === "external") {
    return { status: "ready", url: file.url, name: file.label, contentType: null, sizeBytes: null };
  }
  if (file.kind === "document") return fromDocument(file.id, file.label, tenantId);
  return fromPath(file.path, file.label, file.contentType ?? null, null);
}

/** What the preview can show inline. */
export function previewKind(resolved: { name: string; contentType: string | null; url?: string }) {
  const byType = resolved.contentType ? fileKindOf(resolved.contentType) : "other";
  if (byType !== "other") return byType;
  const byName = fileKindOf(resolved.name);
  if (byName !== "other") return byName;
  // Firebase download URLs carry the object path, extension included.
  return resolved.url ? fileKindOf(decodeURIComponent(resolved.url.split("?")[0] ?? "")) : "other";
}
