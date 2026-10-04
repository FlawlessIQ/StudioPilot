import {
  adminAppCheck,
  adminAuth,
  adminFirestore,
} from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The invitations waiting for the signed-in person's email.
 *
 * Somebody a studio invited — a client, a crew member, a teammate — who
 * signs in without using the invitation link has no membership yet, and
 * every route treated "no membership" as "a new studio". So the invitee was
 * shown "Create your workspace", and a client who filled it in became the
 * owner of a studio of their own and never saw their booking.
 *
 * The onboarding page asks here first. Only a verified email is answered —
 * an unverified address proves nothing about who is asking, and the answer
 * names studios. Nothing is accepted here: joining still takes the link,
 * which is what proves the invitation was meant for this account.
 */

type Kind = "client" | "crew" | "team";

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
}

const live = (expiresAt: unknown) =>
  typeof expiresAt === "string" && Date.parse(expiresAt) > Date.now();

export async function POST(request: Request): Promise<Response> {
  try {
    const token = bearerToken(request);
    if (!token) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
      const appCheckToken = request.headers.get("x-firebase-appcheck");
      if (!appCheckToken) return Response.json({ error: "APP_CHECK_REQUIRED" }, { status: 401 });
      await adminAppCheck.verifyToken(appCheckToken);
    }
    const identity = await adminAuth.verifyIdToken(token, true);
    const email = String(identity.email ?? "").trim().toLowerCase();
    if (!email || identity.email_verified !== true) {
      return Response.json({ invitations: [] });
    }

    const [clients, team, crew] = await Promise.all([
      adminFirestore.collection("clientInvitations").where("normalizedEmail", "==", email).limit(10).get(),
      adminFirestore.collection("tenantInvitations").where("normalizedEmail", "==", email).limit(10).get(),
      adminFirestore.collection("crewProfiles").where("email", "==", email).limit(10).get(),
    ]);
    const waiting: Array<{ tenantId: string; kind: Kind }> = [
      ...clients.docs
        .filter((doc) => doc.get("status") === "pending" && live(doc.get("expiresAt")))
        .map((doc) => ({ tenantId: String(doc.get("tenantId")), kind: "client" as const })),
      ...team.docs
        .filter((doc) => doc.get("status") === "pending" && live(doc.get("expiresAt")))
        .map((doc) => ({ tenantId: String(doc.get("tenantId")), kind: "team" as const })),
      ...crew.docs
        .filter((doc) => Boolean(doc.get("inviteTokenHash")) && !doc.get("userId") && live(doc.get("inviteExpiresAt")))
        .map((doc) => ({ tenantId: String(doc.get("tenantId")), kind: "crew" as const })),
    ].filter((item) => item.tenantId);

    const unique = waiting.filter(
      (item, index) => waiting.findIndex((other) => other.tenantId === item.tenantId && other.kind === item.kind) === index,
    );
    const tenants = await Promise.all(
      unique.map((item) => adminFirestore.doc(`tenants/${item.tenantId}`).get()),
    );
    const invitations = unique.map((item, index) => ({
      kind: item.kind,
      studioName:
        String(tenants[index]?.get("brandName") ?? "") ||
        String(tenants[index]?.get("businessName") ?? "") ||
        "A photography studio",
    }));
    return Response.json({ invitations });
  } catch {
    // An answer of "none" never blocks anyone: onboarding goes on as before.
    return Response.json({ invitations: [] });
  }
}
