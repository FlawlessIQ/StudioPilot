"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

type AuthEmailRequest =
  | {
      type: "passwordReset";
      idempotencyKey: string;
      input: { email: string };
    }
  | {
      type: "emailVerification";
      idempotencyKey: string;
      input: { email: string; next: string | null };
    };

export async function requestBrandedAuthEmail(
  body: AuthEmailRequest,
): Promise<void> {
  const { auth } = getFirebaseClient();
  const appCheckToken = await getAppCheckToken();
  const user = auth.currentUser;
  const response = await fetch("/api/functions/authEmailCommand", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(user
        ? { authorization: `Bearer ${await user.getIdToken()}` }
        : {}),
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(result.error ?? "The account email could not be sent."),
    );
  }
}
