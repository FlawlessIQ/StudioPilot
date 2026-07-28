"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, LoaderCircle, ShieldCheck } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import type { Role } from "@/features/auth/roles";
import {
  isStudioMembership,
  type SignInMembership,
} from "@/features/auth/workspace-routing";
import { getFirebaseClient } from "@/lib/firebase/client";

type WorkspaceOption = SignInMembership & {
  membershipId: string;
  tenantName: string;
};

export function WorkspaceChooser() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { auth, firestore } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/auth/login?next=/auth/workspaces");
        return;
      }
      void (async () => {
        try {
          const [token, membershipSnapshot] = await Promise.all([
            user.getIdTokenResult(),
            getDocs(
              query(
                collection(firestore, "memberships"),
                where("userId", "==", user.uid),
                where("status", "==", "active"),
                limit(20),
              ),
            ),
          ]);
          const memberships = membershipSnapshot.docs
            .map((membershipDocument) => ({
              membershipId: membershipDocument.id,
              tenantId: String(membershipDocument.data().tenantId ?? ""),
              role: String(membershipDocument.data().role ?? "") as Role,
            }))
            .filter(
              (membership) =>
                Boolean(membership.tenantId) &&
                isStudioMembership(membership),
            );
          const tenantDocuments = await Promise.all(
            memberships.map((membership) =>
              getDoc(doc(firestore, "tenants", membership.tenantId)),
            ),
          );
          setPlatformAdmin(token.claims.platformAdmin === true);
          setWorkspaces(
            memberships.map((membership, index) => {
              const tenant = tenantDocuments[index]?.data() ?? {};
              return {
                ...membership,
                tenantName: String(
                  tenant.brandName ??
                    tenant.businessName ??
                    "Studio workspace",
                ),
              };
            }),
          );
        } catch (caught: unknown) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Your workspaces could not be loaded.",
          );
        } finally {
          setLoading(false);
        }
      })();
    });
  }, [router]);

  function openStudio(workspace: WorkspaceOption) {
    window.localStorage.setItem(
      "studiohub.activeTenantId",
      workspace.tenantId,
    );
    router.push("/studio");
  }

  if (loading)
    return (
      <div className="workspace-choice-state">
        <LoaderCircle className="spin" />
        <span>Loading your workspaces…</span>
      </div>
    );

  return (
    <div className="workspace-choice-list">
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {workspaces.map((workspace) => (
        <button
          className="workspace-choice"
          key={workspace.membershipId}
          type="button"
          onClick={() => openStudio(workspace)}
        >
          <Building2 />
          <span>
            <strong>{workspace.tenantName}</strong>
            <small>
              {workspace.role.replaceAll("_", " ")} workspace
            </small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      ))}
      {platformAdmin ? (
        <button
          className="workspace-choice"
          type="button"
          onClick={() => router.push("/platform-admin")}
        >
          <ShieldCheck />
          <span>
            <strong>StudioHub platform</strong>
            <small>Platform administration</small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
      {!workspaces.length && !platformAdmin && !error ? (
        <div className="workspace-choice-state">
          <Building2 />
          <span>No active workspace membership was found.</span>
        </div>
      ) : null}
    </div>
  );
}
