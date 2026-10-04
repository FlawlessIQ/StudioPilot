"use client";

import type { Auth } from "firebase/auth";
import { getAppCheckToken } from "@/lib/firebase/app-check";

export type PendingInvitation = {
  kind: "client" | "crew" | "team";
  studioName: string;
};

/**
 * Invitations waiting for the signed-in person's verified email
 * (app/api/auth/pending-invitations). Any failure is "none": this only ever
 * adds a question before onboarding, it never blocks it.
 */
export async function pendingInvitations(auth: Auth): Promise<PendingInvitation[]> {
  try {
    const user = auth.currentUser;
    if (!user) return [];
    const [idToken, appCheckToken] = await Promise.all([user.getIdToken(), getAppCheckToken()]);
    const response = await fetch("/api/auth/pending-invitations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${idToken}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { invitations?: PendingInvitation[] };
    return Array.isArray(body.invitations) ? body.invitations : [];
  } catch {
    return [];
  }
}
