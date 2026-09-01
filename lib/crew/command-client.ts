"use client";

import { connectStorageEmulator, getStorage, ref, uploadBytes } from "firebase/storage";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { activeMembership } from "@/lib/firebase/active-membership";

export async function sendCrewCommand(
  type: string,
  input: Record<string, unknown>,
): Promise<{ persisted: boolean; result: Record<string, unknown> }> {
  const endpoint = process.env.NEXT_PUBLIC_CREW_FUNCTIONS_URL;
  if (!endpoint) return { persisted: false, result: { preview: true } };
  const { auth, firestore } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before changing a crew assignment.");
  const membership = await activeMembership(firestore, user.uid);
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
  const membership = await activeMembership(client.firestore, user.uid);
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
    /**
     * `visibility` was omitted, so a crew document's exposure was decided by
     * whatever the rules happened to do with a missing key. It is stated now:
     * a W-9 or an insurance certificate is crew-visible, readable by the person
     * who uploaded it and by the studio's operators, and by nobody else.
     */
    customMetadata: { assignmentId: input.assignmentId, requirementId: input.requirementId, scanStatus: "pending", visibility: "crew" },
  });
  return sendCrewCommand("submitRequirement", {
    projectId: input.projectId, assignmentId: input.assignmentId,
    requirementId: input.requirementId, documentId: path,
  });
}

/**
 * A W-9 or certificate of insurance filed against a profile rather than a job.
 *
 * `uploadCrewRequirement` is project-scoped and needs an assignment, so a
 * collaborator with no job yet could not send either of these and a studio
 * could not file one it had already been handed. Same storage constraints as
 * that path — crew-visible, scanned before anyone can read it, never
 * overwriting — under the profile instead of a project.
 */
export async function uploadCrewProfileDocument(input: {
  crewProfileId: string;
  kind: "w9" | "insurance";
  file: File;
}) {
  if (!process.env.NEXT_PUBLIC_CREW_FUNCTIONS_URL) {
    return { persisted: false, result: { preview: true } };
  }
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before uploading crew documents.");
  const membership = await activeMembership(client.firestore, user.uid);
  const tenantId = membership.data().tenantId as string;
  const storage = getStorage(client.app);
  if (
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
    !storageEmulatorConnected
  ) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    storageEmulatorConnected = true;
  }
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `tenants/${tenantId}/crewProfiles/${input.crewProfileId}/${input.kind}/${crypto.randomUUID()}-${safeName}`;
  await uploadBytes(ref(storage, path), input.file, {
    contentType: input.file.type,
    customMetadata: {
      crewProfileId: input.crewProfileId,
      kind: input.kind,
      scanStatus: "pending",
      visibility: "crew",
    },
  });
  return sendCrewCommand("submitCrewProfileDocument", {
    crewProfileId: input.crewProfileId,
    kind: input.kind,
    documentPath: path,
  });
}
