"use client";

import {
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getFirebaseClient } from "@/lib/firebase/client";

const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
let emulatorConnected = false;

export type ClientMessageAttachment = {
  storagePath: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  scanStatus: "pending";
};

export async function uploadClientMessageAttachment(input: {
  tenantId: string;
  projectId: string;
  draftId: string;
  file: File;
}): Promise<ClientMessageAttachment> {
  if (!allowedTypes.has(input.file.type)) {
    throw new Error("Attach a PDF, Word document, JPG, or PNG file.");
  }
  if (input.file.size <= 0 || input.file.size > 12 * 1024 * 1024) {
    throw new Error("Message attachments must be smaller than 12 MB.");
  }
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before attaching a file.");
  const membership = await activeMembership(client.firestore, user.uid);
  const membershipValue = membership.data();
  if (
    membershipValue.tenantId !== input.tenantId ||
    membershipValue.role !== "client" ||
    !Array.isArray(membershipValue.projectIds) ||
    !membershipValue.projectIds.includes(input.projectId)
  ) {
    throw new Error("This attachment is not assigned to your project.");
  }
  const storage = getStorage(client.app);
  if (
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
    !emulatorConnected
  ) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    emulatorConnected = true;
  }
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `tenants/${input.tenantId}/projects/${input.projectId}/clients/${user.uid}/messages/${input.draftId}/${crypto.randomUUID()}-${safeName}`;
  await uploadBytes(ref(storage, path), input.file, {
    contentType: input.file.type,
    customMetadata: {
      scanStatus: "pending",
      visibility: "shared",
      tenantId: input.tenantId,
      projectId: input.projectId,
      messageDraftId: input.draftId,
      uploaderId: user.uid,
    },
  });
  return {
    storagePath: path,
    name: input.file.name,
    contentType: input.file.type,
    sizeBytes: input.file.size,
    scanStatus: "pending",
  };
}
