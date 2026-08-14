"use client";

import { withTimeout } from "@/lib/async/with-timeout";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export async function getStudioRecords(input: {
  collection: string;
  tenantId: string;
  projectId?: string;
  projectScoped?: boolean;
  vendorScoped?: boolean;
}): Promise<Array<Record<string, unknown> & { id: string }>> {
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to load studio records.");
  const appCheckToken = await getAppCheckToken();
  const response = await withTimeout(fetch("/api/studio/records", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify(input),
  }), 15_000, "StudioCue could not load records through its recovery path in time.");
  const result = (await response.json()) as {
    records?: Array<Record<string, unknown> & { id: string }>;
    error?: string;
  };
  if (!response.ok || !result.records) throw new Error(result.error ?? "The record recovery path failed.");
  return result.records;
}
