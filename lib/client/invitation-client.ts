"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export async function runClientInvitation(
  body:
    | {
        type: "invite";
        tenantId: string;
        idempotencyKey: string;
        input: { contactId: string; projectId: string };
      }
    | {
        type: "accept";
        idempotencyKey: string;
        input: { token: string };
      },
) {
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in is required.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch("/api/functions/clientInvitationCommand", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(String(result.error ?? "Client invitation failed."));
  return result;
}
