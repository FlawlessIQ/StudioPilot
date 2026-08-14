import { z } from "zod";
import {
  adminAppCheck,
  adminAuth,
  adminFirestore,
} from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  area: z.enum(["studio", "client", "crew"]),
  preferredTenantId: z.string().min(1).max(160).nullable().optional(),
});

const areaRoles: Record<"studio" | "client" | "crew", ReadonlySet<string>> = {
  studio: new Set<string>([
    "studio_owner",
    "studio_admin",
    "studio_coordinator",
    "staff_photographer",
  ]),
  client: new Set<string>(["client"]),
  crew: new Set<string>(["subcontractor"]),
};

type MembershipRecord = {
  id: string;
  tenantId?: unknown;
  userId?: unknown;
  role?: unknown;
  projectIds?: unknown;
  [key: string]: unknown;
};

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
}

async function verifyRequest(request: Request) {
  const token = bearerToken(request);
  if (!token) throw new Error("AUTHENTICATION_REQUIRED");
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    const appCheckToken = request.headers.get("x-firebase-appcheck");
    if (!appCheckToken) throw new Error("APP_CHECK_REQUIRED");
    await adminAppCheck.verifyToken(appCheckToken);
  }
  return adminAuth.verifyIdToken(token, true);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const [identity, input] = await Promise.all([
      verifyRequest(request),
      request.json().then((body) => requestSchema.parse(body)),
    ]);
    const snapshot = await adminFirestore
      .collection("memberships")
      .where("userId", "==", identity.uid)
      .where("status", "==", "active")
      .limit(20)
      .get();
    const memberships: MembershipRecord[] = snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));
    const permitted = memberships.filter((membership) =>
      areaRoles[input.area].has(String(membership.role)),
    );
    const membership =
      permitted.find(
        (candidate) => candidate.tenantId === input.preferredTenantId,
      ) ?? permitted[0];
    if (!membership || typeof membership.tenantId !== "string") {
      return Response.json({ error: "NO_ACTIVE_WORKSPACE" }, { status: 403 });
    }

    const projectIds = Array.isArray(membership.projectIds)
      ? membership.projectIds.filter(
          (projectId): projectId is string => typeof projectId === "string",
        )
      : [];
    const [tenant, profile, project] = await Promise.all([
      adminFirestore.doc(`tenants/${membership.tenantId}`).get(),
      adminFirestore.doc(`users/${identity.uid}`).get(),
      input.area !== "client" && projectIds[0]
        ? adminFirestore.doc(`projects/${projectIds[0]}`).get()
        : Promise.resolve(null),
    ]);

    return Response.json({
      memberships,
      selectedMembershipId: membership.id,
      tenant: tenant.exists ? { id: tenant.id, ...tenant.data() } : null,
      profile: profile.exists ? { id: profile.id, ...profile.data() } : null,
      project:
        project && project.exists
          ? { id: project.id, ...project.data() }
          : null,
    });
  } catch (caught: unknown) {
    const code = caught instanceof Error ? caught.message : "WORKSPACE_UNAVAILABLE";
    const status = code === "AUTHENTICATION_REQUIRED" ? 401 : 503;
    return Response.json({ error: code }, { status });
  }
}
