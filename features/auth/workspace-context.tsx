"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
} from "firebase/firestore";
import type { Role } from "@/features/auth/roles";
import {
  getClientPortalProject,
  getClientPortalProjects,
  type ClientPortalProject,
  type ClientPortalProjectSummary,
} from "@/lib/client/portal-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  classifySessionFailure,
  type SessionFailureKind,
} from "@/features/auth/session-failure";
import {
  invalidateMembershipCache,
  loadMembershipDocuments,
} from "@/lib/firebase/membership-cache";
import { authIsLive } from "@/lib/runtime-mode";
import { withTimeout } from "@/lib/async/with-timeout";
import {
  getWorkspaceBootstrap,
  type WorkspaceBootstrap,
} from "@/lib/firebase/workspace-bootstrap";

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
  /**
   * Why it failed, so the shell can offer the right action — retry for something
   * transient, sign-in for a session that has ended. Optional: absent means no
   * failure, or one nothing has classified.
   */
  failureKind?: SessionFailureKind | null;
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
  clientProject: ClientPortalProject | null;
  clientProjects: ClientPortalProjectSummary[];
  memberships: WorkspaceMembership[];
};

type WorkspaceContextValue = WorkspaceState & {
  selectProject: (projectId: string) => Promise<void>;
  retry: () => void;
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
  clientProject: null,
  clientProjects: [],
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
      clientProject: null,
      clientProjects: [],
      memberships: [],
    }
  : mockWorkspace;

const WorkspaceContext = createContext<WorkspaceContextValue>({
  ...initialWorkspace,
  selectProject: async () => undefined,
  retry: () => undefined,
});

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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!authIsLive) {
      setState(mockWorkspace);
      return;
    }
    const { auth, firestore } = getFirebaseClient();
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setState((current) => ({
          ...current,
          loading: false,
          error: "Sign in to load this workspace.",
          failureKind: "session_ended" as const,
        }));
        return;
      }
      void (async () => {
        try {
          const storedTenantId = window.localStorage.getItem(
            "studiohub.activeTenantId",
          );
          let bootstrap: WorkspaceBootstrap | null = null;
          let memberships: WorkspaceMembership[];
          try {
            const membershipDocuments = await loadMembershipDocuments(
              firestore,
              user.uid,
              { force: attempt > 0 },
            );
            memberships = membershipDocuments
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
          } catch {
            bootstrap = await getWorkspaceBootstrap(area, storedTenantId);
            memberships = bootstrap.memberships
              .map((membership) => asMembership(membership.id, membership))
              .filter(
                (membership): membership is WorkspaceMembership =>
                  membership !== null,
              );
          }
          const permitted = memberships.filter((membership) =>
            areaRoles[area].includes(membership.role),
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

          const clientProjects =
            area === "client"
              ? (
                  await withTimeout(
                    getClientPortalProjects(membership.tenantId),
                    15_000,
                    "Your project list took too long to load. Try again.",
                  )
                ).projects
              : [];
          const storedClientProjectId = window.localStorage.getItem(
            `studiohub.activeClientProjectId.${membership.tenantId}`,
          );
          const projectId =
            area === "client"
              ? clientProjects.find(
                  (project) => project.id === storedClientProjectId,
                )?.id ??
                clientProjects[0]?.id ??
                null
              : membership.projectIds[0] ?? null;
          if (area === "client" && projectId) {
            window.localStorage.setItem(
              `studiohub.activeClientProjectId.${membership.tenantId}`,
              projectId,
            );
          }
          let tenant: Record<string, unknown> = {};
          let profile: Record<string, unknown> = {};
          let project: Record<string, unknown> = {};
          let clientProject: ClientPortalProject | null = null;
          try {
            const [tenantDocument, userDocument, projectDocument] =
              await withTimeout(
                Promise.all([
                  getDoc(doc(firestore, "tenants", membership.tenantId)),
                  getDoc(doc(firestore, "users", user.uid)),
                  projectId
                    ? area === "client"
                      ? getClientPortalProject(membership.tenantId, projectId)
                      : getDoc(doc(firestore, "projects", projectId))
                    : Promise.resolve(null),
                ]),
                15_000,
                "Your workspace details took too long to load. Try again.",
              );
            tenant = tenantDocument.data() ?? {};
            profile = userDocument.data() ?? {};
            project =
              projectDocument && "data" in projectDocument
                ? projectDocument.data() ?? {}
                : projectDocument ?? {};
            clientProject =
              area === "client" &&
              projectDocument &&
              !("data" in projectDocument)
                ? projectDocument
                : null;
          } catch {
            bootstrap ??= await getWorkspaceBootstrap(area, membership.tenantId);
            tenant = bootstrap.tenant ?? {};
            profile = bootstrap.profile ?? {};
            if (area === "client" && projectId) {
              clientProject = await getClientPortalProject(
                membership.tenantId,
                projectId,
              );
              project = clientProject;
            } else {
              project = bootstrap.project ?? {};
            }
          }
          if (!active) return;
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
            clientProject,
            clientProjects,
            memberships,
          });
        } catch (caught: unknown) {
          if (!active) return;
          setState((current) => ({
            ...current,
            loading: false,
            // Was `caught.message`, which put "The Firebase ID token has
            // been revoked." in front of a photographer.
            error: classifySessionFailure(caught).message,
            failureKind: classifySessionFailure(caught).kind,
          }));
        }
      })();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [area, attempt]);

  const selectProject = useCallback(
    async (projectId: string) => {
      if (area !== "client" || !state.tenantId) return;
      const summary = state.clientProjects.find(
        (project) => project.id === projectId,
      );
      if (!summary || projectId === state.projectId) return;
      window.localStorage.setItem(
        `studiohub.activeClientProjectId.${state.tenantId}`,
        projectId,
      );
      setState((current) => ({
        ...current,
        projectId,
        projectName: summary.name,
        projectDate: summary.eventDate ?? "",
        clientProject: null,
        error: null,
      }));
      try {
        const project = await getClientPortalProject(state.tenantId, projectId);
        setState((current) =>
          current.projectId === projectId
            ? {
                ...current,
                projectName: project.name,
                projectDate: project.eventDate ?? "",
                clientProject: project,
              }
            : current,
        );
      } catch (caught: unknown) {
        setState((current) =>
          current.projectId === projectId
            ? {
                ...current,
                error: classifySessionFailure(caught).message,
                failureKind: classifySessionFailure(caught).kind,
              }
            : current,
        );
      }
    },
    [
      area,
      state.clientProjects,
      state.projectId,
      state.tenantId,
    ],
  );
  const value = useMemo(
    () => ({
      ...state,
      selectProject,
      retry: () => {
        if (state.userId) invalidateMembershipCache(state.userId);
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }));
        setAttempt((current) => current + 1);
      },
    }),
    [selectProject, state],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
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
