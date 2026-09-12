import { createHash } from "node:crypto";
import { adminFirestore } from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A vendor confirming a run of show works for them.
 *
 * POST only, on purpose — a GET that confirms would fire from a link scanner or
 * a browser prefetch, and the studio would see a confirmation the vendor never
 * made. The token authorises one thing: marking this one share acknowledged. It
 * carries no ability to read or change the timeline.
 */
export async function POST(request: Request): Promise<Response> {
  let token = "";
  try {
    const form = await request.formData();
    token = String(form.get("token") ?? "");
  } catch {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (!token) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = new Date().toISOString();

  const matches = await adminFirestore
    .collection("scheduleShares")
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();
  const reference = matches.docs[0]?.ref;
  if (!reference) {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 404 });
  }

  const outcome = await adminFirestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    if (!data) return { status: "unknown" as const };
    if (data.status === "revoked") return { status: "revoked" as const };
    if (String(data.expiresAt ?? "") < now) return { status: "expired" as const };
    if (data.status === "acknowledged") return { status: "already" as const, data };
    transaction.update(reference, {
      status: "acknowledged",
      acknowledgedAt: now,
      acknowledgedVersion: data.sharedVersion ?? null,
      // Confirming implies they saw it, even if the view stamp somehow missed.
      viewedAt: data.viewedAt ?? now,
      updatedAt: now,
    });
    return { status: "claimed" as const, data };
  });

  if (outcome.status === "already") {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com")
      .replace(/\/$/, "");
    return Response.redirect(`${appUrl}/share/confirmed`, 303);
  }
  if (outcome.status !== "claimed") {
    return Response.json(
      { error: outcome.status.toUpperCase() },
      { status: 409 },
    );
  }

  const share = outcome.data as Record<string, unknown>;
  const auditId = `ros_share_ack_${tokenHash.slice(0, 32)}`;
  await adminFirestore.doc(`auditEvents/${auditId}`).set({
    id: auditId,
    tenantId: share.tenantId,
    projectId: share.projectId ?? null,
    // No signed-in user: the authority is the one-time link the vendor holds.
    actorId: "run_of_show_share_token",
    actorType: "system",
    action: "run_of_show.vendor_acknowledged",
    entityType: "schedule_share",
    entityId: share.id,
    timestamp: now,
    before: { status: share.status },
    after: { status: "acknowledged", vendorContactId: share.vendorContactId },
    ipAddress: null,
    userAgent: request.headers.get("user-agent") ?? null,
    correlationId: auditId,
    automationRunId: null,
    providerEventId: null,
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com")
    .replace(/\/$/, "");
  return Response.redirect(`${appUrl}/share/confirmed`, 303);
}
