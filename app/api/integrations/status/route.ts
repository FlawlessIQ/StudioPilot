import { adminAuth, adminFirestore } from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedRoles = new Set(["studio_owner", "studio_admin"]);

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
}

export async function GET(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  try {
    const identity = await adminAuth.verifyIdToken(token, true);
    const preferredTenantId = new URL(request.url).searchParams.get("tenantId");
    let membership:
      | FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
      | FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>
      | null = null;

    if (preferredTenantId) {
      const preferred = await adminFirestore
        .doc(`memberships/${preferredTenantId}_${identity.uid}`)
        .get();
      if (preferred.exists) membership = preferred;
    }

    if (!membership) {
      const memberships = await adminFirestore
        .collection("memberships")
        .where("userId", "==", identity.uid)
        .where("status", "==", "active")
        .limit(20)
        .get();
      membership =
        memberships.docs.find((document) =>
          allowedRoles.has(String(document.get("role"))),
        ) ?? null;
    }

    if (
      !membership ||
      membership.get("status") !== "active" ||
      !allowedRoles.has(String(membership.get("role")))
    ) {
      return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const tenantId = membership.get("tenantId");
    if (typeof tenantId !== "string") {
      return Response.json({ error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    const [connectionsSnapshot, routingSnapshot] = await Promise.all([
      adminFirestore
        .collection("integrationConnections")
        .where("tenantId", "==", tenantId)
        .get(),
      adminFirestore.doc(`integrationRouting/${tenantId}`).get(),
    ]);

    const connections = connectionsSnapshot.docs.map((document) => {
      const value = document.data();
      return {
        provider: value.provider,
        status: value.status,
        archivedAt: typeof value.archivedAt === "string" ? value.archivedAt : null,
        mockMode: Boolean(value.mockMode),
        displayName: typeof value.displayName === "string" ? value.displayName : null,
        lastHealthCheckAt:
          typeof value.lastHealthCheckAt === "string"
            ? value.lastHealthCheckAt
            : null,
        lastHealthLatencyMs:
          typeof value.lastHealthLatencyMs === "number"
            ? value.lastHealthLatencyMs
            : null,
        lastError: typeof value.lastError === "string" ? value.lastError : null,
        diagnostics:
          typeof value.diagnostics === "object" && value.diagnostics !== null
            ? value.diagnostics
            : null,
      };
    });
    const routing = routingSnapshot.data();

    return Response.json({
      tenantId,
      connections,
      selections:
        routing && typeof routing.selections === "object"
          ? routing.selections
          : {},
    });
  } catch {
    return Response.json({ error: "INTEGRATION_STATUS_UNAVAILABLE" }, { status: 500 });
  }
}
