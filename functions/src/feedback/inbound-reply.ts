import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * A studio's reply to team mail about their feedback, arriving through the
 * inbound parser (communications/inbound.ts) on a signed `feedback+…` address.
 *
 * It joins the feedback's thread in the Console and puts the feedback back to
 * "new", so somebody looks. Stored once per message id, so SendGrid retrying a
 * delivery doesn't duplicate it.
 */
export async function recordFeedbackReply(
  db: Firestore,
  feedbackId: string,
  message: { messageId: string; from: string; fromName: string | null; subject: string; text: string },
  now: string,
): Promise<"recorded" | "duplicate" | "missing"> {
  const feedback = await db.doc(`feedback/${feedbackId}`).get();
  if (!feedback.exists) return "missing";
  const id = `in_${createHash("sha256").update(`${feedbackId}:${message.messageId}`).digest("hex").slice(0, 32)}`;
  const reference = db.doc(`feedbackMessages/${id}`);
  const senderEmail = String(feedback.get("userEmail") ?? "").toLowerCase();
  try {
    await reference.create({
      id,
      feedbackId,
      tenantId: feedback.get("tenantId") ?? null,
      direction: "inbound",
      visibleToSender: true,
      senderUserId: feedback.get("userId") ?? null,
      body: message.text.slice(0, 20_000),
      subject: message.subject.slice(0, 300),
      fromEmail: message.from,
      fromName: message.fromName,
      // A reply from another address is kept, and flagged, rather than lost.
      fromMatchesSender: Boolean(senderEmail) && senderEmail === message.from.toLowerCase(),
      providerMessageId: message.messageId.slice(0, 300),
      createdAt: now,
    });
  } catch (caught) {
    if ((caught as { code?: number }).code === 6) return "duplicate";
    throw caught;
  }
  await feedback.ref.update({
    triage: "new",
    lastInboundAt: now,
    inboundCount: FieldValue.increment(1),
    updatedAt: now,
  });
  return "recorded";
}
