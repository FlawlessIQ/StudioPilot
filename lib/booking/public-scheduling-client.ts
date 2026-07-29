"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getFirebaseClient } from "@/lib/firebase/client";

export async function runPublicScheduling(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const client = getFirebaseClient();
  const appCheckToken = await getAppCheckToken();
  const user = client.auth.currentUser;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
  };
  let requestBody = body;
  if (body.type === "create_link") {
    if (!user) throw new Error("Sign in before sending a scheduling link.");
    const membership = await activeMembership(client.firestore, user.uid);
    headers.authorization = `Bearer ${await user.getIdToken()}`;
    requestBody = {
      ...body,
      tenantId: String(membership.data().tenantId),
    };
  }
  const response = await fetch(
    "/api/functions/publicConsultationScheduling",
    {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(payload.error ?? "Consultation scheduling could not continue."),
    );
  }
  return payload;
}
