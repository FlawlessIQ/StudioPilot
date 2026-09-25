"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { activeMembership } from "@/lib/firebase/active-membership";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";

type CrmCommandResult = Record<string, unknown>;

export async function runCrmCommand(
  type: string,
  input: Record<string, unknown>,
): Promise<{ persisted: boolean; result: CrmCommandResult }> {
  const endpoint = process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL;
  if (!endpoint) {
    return {
      persisted: false,
      result: { reference: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}` },
    };
  }

  const { auth, firestore } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before making studio changes.");
  const membership = await activeMembership(firestore, user.uid);

  const appCheckToken = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/crmCommand`, {
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
  // Never let a non-JSON error page become "Unexpected token '<'" — the
  // parse failure must read as a server problem, not gibberish.
  const result = (await response
    .json()
    .catch(() => ({ error: "FUNCTION_UPSTREAM_UNAVAILABLE" }))) as CrmCommandResult;
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : "Studio command failed.");
  }
  markTenantRecordsWritten();
  return { persisted: true, result };
}

const TEAM_ROLE_WORDS: Record<string, string> = {
  subcontractor: "one of your crew",
  staff_photographer: "one of your team",
  staff_videographer: "one of your team",
  studio_coordinator: "one of your team",
  studio_admin: "one of your team",
  studio_owner: "you, the studio owner",
};

/**
 * The warning crmCommand returns when a client's email already belongs to
 * someone on the studio's team or crew (functions/src/crm/team-email.ts).
 * That address can never become this client's portal login.
 */
export function teamEmailWarning(result: CrmCommandResult | Record<string, unknown>): string | null {
  const role = (result as { emailBelongsToTeamRole?: unknown }).emailBelongsToTeamRole;
  if (typeof role !== "string" || !role) return null;
  return `That email belongs to ${TEAM_ROLE_WORDS[role] ?? "someone on your team"}, so it can't be this client's portal login — invitations, proposals and contracts sent there won't reach a client account. Use the client's own address.`;
}
