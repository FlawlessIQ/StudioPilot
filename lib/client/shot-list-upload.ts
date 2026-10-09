"use client";

import { connectStorageEmulator, getStorage, ref, uploadBytes } from "firebase/storage";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getFirebaseClient } from "@/lib/firebase/client";
import { SHOT_LIST_MAX_BYTES, shotListContentType } from "@/features/planning/shot-list";

/**
 * One file of a couple's shot list, into their own folder for this job
 * (storage.rules, `clients/{uid}/shot-list`). Scanned like every upload
 * before the studio can open it (operations/file-safety.ts); saved to the
 * job by `submit_shot_list` once every file is up.
 */

let emulatorConnected = false;

export type ShotListUpload = { storagePath: string; name: string; contentType: string; sizeBytes: number };

export async function uploadShotListFile(input: { tenantId: string; projectId: string; file: File }): Promise<ShotListUpload> {
  const contentType = shotListContentType(input.file);
  if (!contentType) throw new Error(`${input.file.name}: upload a PDF, Word document, photo (JPG or PNG), text or CSV file.`);
  if (input.file.size <= 0) throw new Error(`${input.file.name} is empty.`);
  if (input.file.size > SHOT_LIST_MAX_BYTES) throw new Error(`${input.file.name} is over 12 MB. Try a smaller copy or a PDF.`);
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in again to upload your list.");
  const membership = (await activeMembership(client.firestore, user.uid)).data();
  if (
    membership.tenantId !== input.tenantId ||
    membership.role !== "client" ||
    !Array.isArray(membership.projectIds) ||
    !membership.projectIds.includes(input.projectId)
  )
    throw new Error("This list can't be added to this event. Sign in again and try once more.");
  const storage = getStorage(client.app);
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && !emulatorConnected) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    emulatorConnected = true;
  }
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const storagePath = `tenants/${input.tenantId}/projects/${input.projectId}/clients/${user.uid}/shot-list/${crypto.randomUUID()}-${safeName}`;
  await uploadBytes(ref(storage, storagePath), input.file, {
    contentType,
    customMetadata: {
      scanStatus: "pending",
      visibility: "client",
      tenantId: input.tenantId,
      projectId: input.projectId,
      purpose: "shot_list",
      uploaderId: user.uid,
    },
  });
  return { storagePath, name: input.file.name.slice(0, 240), contentType, sizeBytes: input.file.size };
}
