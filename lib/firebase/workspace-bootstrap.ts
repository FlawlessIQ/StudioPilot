"use client";

import type { Role } from "@/features/auth/roles";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { withTimeout } from "@/lib/async/with-timeout";

export type WorkspaceBootstrapMembership = {
  id: string;
  tenantId: string;
  userId: string;
  role: Role;
  projectIds: string[];
};

export type WorkspaceBootstrap = {
  memberships: WorkspaceBootstrapMembership[];
  selectedMembershipId: string;
  tenant: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
};

export async function getWorkspaceBootstrap(
  area: "studio" | "client" | "crew",
  preferredTenantId?: string | null,
): Promise<WorkspaceBootstrap> {
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to load this workspace.");
  const appCheckToken = await getAppCheckToken();
  const response = await withTimeout(
    fetch("/api/workspace/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({ area, preferredTenantId: preferredTenantId ?? null }),
    }),
    15_000,
    "StudioCue could not load the workspace through its recovery path in time.",
  );
  const result = (await response.json()) as WorkspaceBootstrap & { error?: string };
  if (!response.ok) {
    throw new Error(result.error ?? "The workspace recovery path failed.");
  }
  return result;
}
