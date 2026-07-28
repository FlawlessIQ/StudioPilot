"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
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
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

type WorkspaceArea = "studio" | "client" | "crew";

type WorkspaceMembership = {
  id: string;
  tenantId: string;
  userId: string;
  role: Role;
  projectIds: string[];
};

type WorkspaceState = {
  loading: boolean;
  error: string | null;
  userId: string | null;
  userName: string;
  userEmail: string;
  tenantId: string | null;
  tenantName: string;
  tenantSlug: string;
  tenantPlan: string;
  role: Role | null;
  projectIds: string[];
  projectId: string | null;
  projectName: string;
  projectDate: string;
  memberships: WorkspaceMembership[];
};

const mockWorkspace: WorkspaceState = {
  loading: false,
  error: null,
  userId: "demo-user",
  userName: "Demo studio owner",
  userEmail: "owner@example.test",
  tenantId: "demo-tenant",
  tenantName: "StudioCue Demo Studio",
  tenantSlug: "studiocue-demo-studio",
  tenantPlan: "Studio",
  role: "studio_owner",
  projectIds: [],
  projectId: null,
  projectName: "Demo project",
  projectDate: "Date pending",
  memberships: [],
};

const initialWorkspace: WorkspaceState = authIsLive
  ? {
      loading: true,
      error: null,
      userId: null,
      userName: "Signed-in user",
      userEmail: "",
      tenantId: null,
      tenantName: "Loading studio…",
      tenantSlug: "",
      tenantPlan: "",
      role: null,
      projectIds: [],
      projectId: null,
      projectName: "Loading project…",
      projectDate: "",
      memberships: [],
    }
  : mockWorkspace;

const WorkspaceContext = createContext<WorkspaceState>(initialWorkspace);

const areaRoles: Record<WorkspaceArea, Role[]> = {
  studio: [
    "studio_owner",
    "studio_admin",
    "studio_coordinator",
    "staff_photographer",
  ],
  client: ["client"],
  crew: ["subcontractor"],
};

function roleLabel(role: Role | null): string {
  return role ? role.replaceAll("_", " ") : "";
}

function asMembership(
  id: string,
  value: Record<string, unknown>,
): WorkspaceMembership | null {
  const tenantId = value.tenantId;
  const userId = value.userId;
  const role = value.role;
  if (
    typeof tenantId !== "string" ||
    typeof userId !== "string" ||
    typeof role !== "string" ||
    !areaRoles.studio
      .concat(areaRoles.client, areaRoles.crew)
      .includes(role as Role)
  ) {
    return null;
  }
  return {
    id,
    tenantId,
    userId,
    role: role as Role,
    projectIds: Array.isArray(value.projectIds)
      ? value.projectIds.filter(
          (projectId): projectId is string => typeof projectId === "string",
        )
      : [],
  };
}

export function WorkspaceProvider({
  area,
  children,
}: {
  area: WorkspaceArea;
  children: React.ReactNode;
}) {
  const [state, setState] = useState(initialWorkspace);

  useEffect(() => {
    if (!authIsLive) {
      setState(mockWorkspace);
      return;
    }
    const { auth, firestore } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        setState((current) => ({
          ...current,
          loading: false,
          error: "Sign in to load this workspace.",
        }));
        return;
      }
      void (async () => {
        try {
          const membershipSnapshot = await getDocs(
            query(
              collection(firestore, "memberships"),
              where("userId", "==", user.uid),
              where("status", "==", "active"),
              limit(20),
            ),
          );
          const memberships = membershipSnapshot.docs
            .map((membershipDocument) =>
              asMembership(
                membershipDocument.id,
                membershipDocument.data(),
              ),
            )
            .filter(
              (membership): membership is WorkspaceMembership =>
                membership !== null,
            );
          const permitted = memberships.filter((membership) =>
            areaRoles[area].includes(membership.role),
          );
          const storedTenantId = window.localStorage.getItem(
            "studiohub.activeTenantId",
          );
          const membership =
            permitted.find((item) => item.tenantId === storedTenantId) ??
            permitted[0];
          if (!membership) {
            throw new Error("No active workspace membership was found.");
          }
          window.localStorage.setItem(
            "studiohub.activeTenantId",
            membership.tenantId,
          );

          const projectId = membership.projectIds[0] ?? null;
          const [tenantDocument, userDocument, projectDocument] =
            await Promise.all([
              getDoc(doc(firestore, "tenants", membership.tenantId)),
              getDoc(doc(firestore, "users", user.uid)),
              projectId
                ? getDoc(doc(firestore, "projects", projectId))
                : Promise.resolve(null),
            ]);
          const tenant = tenantDocument.data() ?? {};
          const profile = userDocument.data() ?? {};
          const project = projectDocument?.data() ?? {};
          setState({
            loading: false,
            error: null,
            userId: user.uid,
            userName:
              String(profile.displayName ?? user.displayName ?? user.email) ||
              "Signed-in user",
            userEmail: String(profile.email ?? user.email ?? ""),
            tenantId: membership.tenantId,
            tenantName: String(
              tenant.brandName ?? tenant.businessName ?? "Your studio",
            ),
            tenantSlug: String(tenant.publicSlug ?? ""),
            tenantPlan: String(
              tenant.subscriptionPlan
                ? `${tenant.subscriptionPlan} plan`
                : roleLabel(membership.role),
            ),
            role: membership.role,
            projectIds: membership.projectIds,
            projectId,
            projectName: String(project.name ?? "No assigned project"),
            projectDate: String(project.eventDate ?? ""),
            memberships,
          });
        } catch (caught: unknown) {
          setState((current) => ({
            ...current,
            loading: false,
            error:
              caught instanceof Error
                ? caught.message
                : "The workspace could not be loaded.",
          }));
        }
      })();
    });
  }, [area]);

  const value = useMemo(() => state, [state]);
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceState {
  return useContext(WorkspaceContext);
}

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "S") + (parts[1]?.[0] ?? "");
}

export function workspaceRoleLabel(role: Role | string | null): string {
  if (!role) return "Member";
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
