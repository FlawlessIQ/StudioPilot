"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type ClientInvitationPreview = {
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  studioName: string;
  projectName: string;
  eventDate: string | null;
  brandAccentColor: string;
  brandLogoUrl: string | null;
  maskedEmail: string;
};

export async function runClientInvitation(
  body:
    | {
        type: "preview";
        idempotencyKey: string;
        input: { token: string };
      }
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
      }
    | {
        type: "status";
        tenantId: string;
        idempotencyKey: string;
        input: { contactId: string };
      }
    | {
        type: "status_batch";
        tenantId: string;
        idempotencyKey: string;
        input: { contactIds: string[] };
      }
    | {
        type: "revoke";
        tenantId: string;
        idempotencyKey: string;
        input: { invitationId: string };
      },
) {
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user && body.type !== "preview") throw new Error("AUTHENTICATION_REQUIRED");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch("/api/functions/clientInvitationCommand", {
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
  if (!response.ok)
    throw new Error(String(result.error ?? "Client invitation failed."));
  return result;
}
