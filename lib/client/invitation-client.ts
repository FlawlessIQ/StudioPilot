"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type ClientInvitationPreview = {
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  studioName: string;
  /** The studio's trade (features/trades): the portal line names what it does. */
  trade?: string | null;
  projectName: string;
  eventDate: string | null;
  brandAccentColor: string;
  brandLogoUrl: string | null;
  maskedEmail: string;
  /** The address in full, so the page can create an account against it. */
  email: string;
  hasAccount: boolean;
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
      }
    | {
        /** The studio's public name and look, for a link that no longer opens. */
        type: "brand";
        idempotencyKey: string;
        input: { studio: string };
      },
) {
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user && body.type !== "preview" && body.type !== "brand") throw new Error("AUTHENTICATION_REQUIRED");
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
