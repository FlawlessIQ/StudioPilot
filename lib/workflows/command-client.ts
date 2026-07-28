"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { activeMembership } from "@/lib/firebase/active-membership";

export async function runWorkflowCommand(
  type: string,
  input: Record<string, unknown>,
): Promise<{ persisted: boolean; result: Record<string, unknown> }> {
  const endpoint = process.env.NEXT_PUBLIC_WORKFLOW_FUNCTIONS_URL;
  if (!endpoint) {
    return {
      persisted: false,
      result: { reference: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}` },
    };
  }

  const { auth, firestore } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before making workflow changes.");
  const membership = await activeMembership(firestore, user.uid);
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/workflowCommand`, {
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
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string" ? result.error : "Workflow command failed.",
    );
  }
  return { persisted: true, result };
}
