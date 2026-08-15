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

export async function uploadClientQuestionnaireFile(input: {
  tenantId: string;
  projectId: string;
  responseId: string;
  fieldId: string;
  file: File;
}) {
  if (!allowedTypes.has(input.file.type)) {
    throw new Error("Upload a PDF, Word document, JPG, or PNG file.");
  }
  if (input.file.size <= 0 || input.file.size > 12 * 1024 * 1024) {
    throw new Error("Questionnaire attachments must be smaller than 12 MB.");
  }
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before uploading an attachment.");
  const membership = await activeMembership(client.firestore, user.uid);
  if (
    membership.data().tenantId !== input.tenantId ||
    membership.data().role !== "client" ||
    !Array.isArray(membership.data().projectIds) ||
    !membership.data().projectIds.includes(input.projectId)
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
  const path = `tenants/${input.tenantId}/projects/${input.projectId}/clients/${user.uid}/questionnaires/${input.responseId}/${crypto.randomUUID()}-${safeName}`;
  await uploadBytes(ref(storage, path), input.file, {
    contentType: input.file.type,
    customMetadata: {
      scanStatus: "pending",
      visibility: "client",
      tenantId: input.tenantId,
      projectId: input.projectId,
      responseId: input.responseId,
      fieldId: input.fieldId,
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
