"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronsUpDown } from "lucide-react";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import type { Role } from "@/features/auth/roles";
import { isStudioMembership } from "@/features/auth/workspace-routing";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

type StudioMembership = {
  tenantId: string;
  role: Role;
};

export function PlatformWorkspaceSwitcher() {
  const router = useRouter();
  const [memberships, setMemberships] = useState<StudioMembership[]>([]);
  const [recoverableTenantId, setRecoverableTenantId] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { auth, firestore } = getFirebaseClient();
    const user = auth.currentUser;
    if (!user) return;
    void Promise.all([
      getDocs(
        query(
          collection(firestore, "memberships"),
          where("userId", "==", user.uid),
          where("status", "==", "active"),
          limit(20),
        ),
      ),
      getDocs(
        query(
          collection(firestore, "tenants"),
          where("createdBy", "==", user.uid),
          limit(20),
        ),
      ),
    ])
      .then(([membershipSnapshot, tenantSnapshot]) => {
        const activeMemberships = membershipSnapshot.docs
          .map((item) => ({
            tenantId: String(item.data().tenantId ?? ""),
            role: String(item.data().role ?? "") as Role,
          }))
          .filter(
            (membership) =>
              Boolean(membership.tenantId) &&
              isStudioMembership(membership),
          );
        setMemberships(activeMemberships);
        const activeTenantIds = new Set(
          activeMemberships.map((membership) => membership.tenantId),
        );
        const recoverable = tenantSnapshot.docs.find(
          (tenant) => !activeTenantIds.has(tenant.id),
        );
        setRecoverableTenantId(recoverable?.id ?? null);
      })
      .catch(() => {
        setNotice("Studio memberships could not be checked.");
      });
  }, []);

  function openWorkspace() {
    if (memberships.length === 1 && memberships[0]) {
      window.localStorage.setItem(
        "studiohub.activeTenantId",
        memberships[0].tenantId,
      );
      router.push("/studio");
      return;
    }
    router.push("/auth/workspaces");
  }

  async function recoverWorkspace() {
    const endpoint = process.env.NEXT_PUBLIC_SAAS_ADMIN_FUNCTIONS_URL;
    const user = getFirebaseClient().auth.currentUser;
    if (!endpoint || !user || !recoverableTenantId) return;
    setBusy(true);
    setNotice(null);
    try {
      const appCheckToken = await getAppCheckToken();
      const response = await fetch(
        `${endpoint.replace(/\/$/, "")}/saasAdminCommand`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await user.getIdToken()}`,
            ...(appCheckToken
              ? { "x-firebase-appcheck": appCheckToken }
              : {}),
          },
          body: JSON.stringify({
            type: "repairOwnerMembership",
            input: { tenantId: recoverableTenantId },
          }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Owner access could not be recovered.");
      window.localStorage.setItem(
        "studiohub.activeTenantId",
        recoverableTenantId,
      );
      router.push("/studio");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "Owner access could not be recovered.",
      );
      setBusy(false);
    }
  }

  if (!memberships.length && !recoverableTenantId && !notice) return null;

  return (
    <button
      className="admin-workspace-switcher"
      type="button"
      onClick={
        recoverableTenantId && !memberships.length
          ? () => void recoverWorkspace()
          : openWorkspace
      }
      disabled={busy}
    >
      <Building2 size={17} />
      <span>
        <strong>
          {recoverableTenantId && !memberships.length
            ? "Recover studio access"
            : "Open studio workspace"}
        </strong>
        <small>
          {notice ??
            (recoverableTenantId && !memberships.length
              ? "Restore your verified owner membership"
              : "Your active tenant membership")}
        </small>
      </span>
      <ChevronsUpDown size={15} />
    </button>
  );
}
