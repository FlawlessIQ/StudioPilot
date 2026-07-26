"use client";

import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { connectStorageEmulator, getStorage, ref, uploadBytes } from "firebase/storage";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export async function sendCrewCommand(
  type: string,
  input: Record<string, unknown>,
): Promise<{ persisted: boolean; result: Record<string, unknown> }> {
  const endpoint = process.env.NEXT_PUBLIC_CREW_FUNCTIONS_URL;
  if (!endpoint) return { persisted: false, result: { preview: true } };
  const { auth, firestore } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before changing a crew assignment.");
  const memberships = await getDocs(query(
    collection(firestore, "memberships"),
    where("userId", "==", user.uid),
    where("status", "==", "active"),
    limit(1),
  ));
  const membership = memberships.docs[0];
  if (!membership) throw new Error("No active studio membership was found.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/crewCommand`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify({
      type, tenantId: membership.data().tenantId as string,
      idempotencyKey: crypto.randomUUID(), input,
    }),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Crew command failed.");
  return { persisted: true, result };
}

let storageEmulatorConnected = false;

export async function uploadCrewRequirement(input: {
  projectId: string;
  assignmentId: string;
  requirementId: string;
  file: File;
}) {
  if (!process.env.NEXT_PUBLIC_CREW_FUNCTIONS_URL) {
    return { persisted: false, result: { preview: true } };
  }
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before uploading crew documents.");
  const memberships = await getDocs(query(
    collection(client.firestore, "memberships"),
    where("userId", "==", user.uid),
    where("status", "==", "active"),
    limit(1),
  ));
  const membership = memberships.docs[0];
  if (!membership) throw new Error("No active studio membership was found.");
  const tenantId = membership.data().tenantId as string;
  const storage = getStorage(client.app);
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && !storageEmulatorConnected) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    storageEmulatorConnected = true;
  }
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `tenants/${tenantId}/projects/${input.projectId}/crew/${user.uid}/${input.assignmentId}/${crypto.randomUUID()}-${safeName}`;
  await uploadBytes(ref(storage, path), input.file, {
    contentType: input.file.type,
    customMetadata: { assignmentId: input.assignmentId, requirementId: input.requirementId },
  });
  return sendCrewCommand("submitRequirement", {
    projectId: input.projectId, assignmentId: input.assignmentId,
    requirementId: input.requirementId, documentId: path,
  });
}
