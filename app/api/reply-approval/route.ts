import { createHash } from "node:crypto";
import { adminFirestore } from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send a reply the studio approved from its notification email.
 *
 * POST only, on purpose. A GET that sends would fire from a link scanner, a mail
 * client fetching previews, or a browser prefetch — so the email links to a page
 * that shows the reply, and only this endpoint sends it.
 *
 * The token authorises one thing: sending this exact pre-composed body to this
 * one client. It carries no ability to read data or to supply text of its own,
 * it is single use, and it expires after 48 hours.
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
  const reference = adminFirestore.doc(`replyApprovals/${tokenHash}`);
  const now = new Date().toISOString();

  // Claimed in a transaction so a double tap — or a second person with the same
  // forwarded email — cannot send the reply twice.
  const outcome = await adminFirestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return { status: "unknown" as const };
    const data = snapshot.data() ?? {};
    if (data.usedAt) return { status: "already_sent" as const };
    if (String(data.expiresAt ?? "") < now) return { status: "expired" as const };
    transaction.set(reference, { usedAt: now }, { merge: true });
    return { status: "claimed" as const, data };
  });

  if (outcome.status !== "claimed") {
    return Response.json({ error: outcome.status.toUpperCase() }, { status: 409 });
  }

  const approval = outcome.data as Record<string, unknown>;
  const jobId = `approved_reply_${tokenHash.slice(0, 32)}`;
  // Goes out on the same retrying, branded path as every other studio email,
  // rather than a second sending mechanism that would drift from the first.
  await adminFirestore.doc(`emailJobs/${jobId}`).set({
    id: jobId,
    tenantId: approval.tenantId,
    projectId: approval.projectId ?? null,
    type: "manual_message",
    recipient: approval.recipientEmail,
    recipientName: approval.recipientName ?? null,
    contactId: approval.contactId ?? null,
    subject: approval.subject,
    customBody: approval.replyBody,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });

  await adminFirestore.doc(`auditEvents/${jobId}`).set({
    id: jobId,
    tenantId: approval.tenantId,
    projectId: approval.projectId ?? null,
    // No signed-in user: the authority is the one-time token that reached the
    // studio's own notification address, and that is what the record should say.
    actorId: "reply_approval_token",
    actorType: "system",
    action: "message.prepared_reply_approved",
    entityType: "conversation",
    entityId: approval.conversationId,
    timestamp: now,
    before: null,
    after: { inboundMessageId: approval.inboundMessageId, emailJobId: jobId },
    ipAddress: null,
    userAgent: request.headers.get("user-agent") ?? null,
    correlationId: jobId,
    automationRunId: null,
    providerEventId: null,
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com")
    .replace(/\/$/, "");
  return Response.redirect(`${appUrl}/reply/sent`, 303);
}
