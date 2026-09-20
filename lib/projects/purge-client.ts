"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { activeMembership } from "@/lib/firebase/active-membership";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";
import type { PurgeLine } from "@/features/projects/purge-policy";

export type PurgePreview = {
  projectId: string;
  projectName: string;
  lines: PurgeLine[];
  fileCount: number;
  clientsDeleted: string[];
  clientsKept: string[];
};

export type PurgeOutcome = {
  purgeId: string;
  status: string;
  filesDeleted: number;
  contactsDeleted: number;
};

/**
 * The relay, not a Functions origin.
 *
 * In production every `NEXT_PUBLIC_*_FUNCTIONS_URL` is `/api/functions`, so
 * this rides the same path as every other command and the Function stays
 * private. It shares the CRM variable because a job's lifecycle is what this
 * is part of; the relay routes on the Function name, not the variable.
 */
async function call(
  type: "previewProjectPurge" | "purgeProject",
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const endpoint = process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL;
  if (!endpoint) throw new Error("PROJECT_PURGE_PREVIEW_UNAVAILABLE");
  const { auth, firestore } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before deleting a job.");
  const membership = await activeMembership(firestore, user.uid);
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/projectPurgeCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({
        type,
        tenantId: membership.data().tenantId as string,
        idempotencyKey: crypto.randomUUID(),
        input,
      }),
    },
  );
  const result = (await response
    .json()
    .catch(() => ({ error: "FUNCTION_UPSTREAM_UNAVAILABLE" }))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new Error(
      typeof result.error === "string" ? result.error : "PROJECT_PURGE_FAILED",
    );
  return result;
}

export async function previewProjectPurge(
  projectId: string,
): Promise<PurgePreview> {
  return (await call("previewProjectPurge", { projectId })) as PurgePreview;
}

export async function purgeProject(input: {
  projectId: string;
  confirmation: string;
}): Promise<PurgeOutcome> {
  const result = await call("purgeProject", input);
  markTenantRecordsWritten();
  return result as PurgeOutcome;
}
