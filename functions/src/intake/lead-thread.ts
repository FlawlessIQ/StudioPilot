import type { Firestore } from "firebase-admin/firestore";
import {
  conversationIdFor,
  type Conversation,
} from "../communications/conversation.js";

/**
 * A lead's thread follows it onto the job it becomes.
 *
 * Conversation ids are derived from their scope (`lead:` before conversion,
 * `project:` after), so on conversion the couple's inquiry and the studio's
 * first reply would otherwise stay on a lead nobody opens again, and the next
 * send from the job would start a second, empty thread with the same people.
 *
 * The lead thread is folded into the job's thread for the same participant and
 * left behind as a pointer (`movedTo`), because the reply address already in
 * the couple's mailbox still names it — inbound follows the pointer.
 */
export async function moveLeadThreadsToProject(
  db: Firestore,
  input: { tenantId: string; leadId: string; projectId: string; now: string },
): Promise<string[]> {
  const threads = await db
    .collection("conversations")
    .where("tenantId", "==", input.tenantId)
    .where("leadId", "==", input.leadId)
    .get();
  const moved: string[] = [];
  for (const thread of threads.docs) {
    const current = thread.data() as Conversation & { movedTo?: string };
    if (current.movedTo || current.projectId) continue;
    const targetId = conversationIdFor({
      tenantId: input.tenantId,
      projectId: input.projectId,
      participant: current.participant,
    });
    const target = db.doc(`conversations/${targetId}`);
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(target);
      const other = existing.exists ? (existing.data() as Conversation) : null;
      const newer = !other || current.lastMessageAt >= other.lastMessageAt ? current : other;
      transaction.set(
        target,
        {
          ...(other ?? current),
          id: targetId,
          tenantId: input.tenantId,
          projectId: input.projectId,
          leadId: input.leadId,
          channels: [...new Set([...(other?.channels ?? []), ...current.channels])].sort(),
          subject: other?.subject ?? current.subject,
          lastMessageAt: newer.lastMessageAt,
          lastMessagePreview: newer.lastMessagePreview,
          lastMessageDirection: newer.lastMessageDirection,
          lastMessageChannel: newer.lastMessageChannel,
          studioUnreadCount: (other?.studioUnreadCount ?? 0) + current.studioUnreadCount,
          clientUnreadCount: (other?.clientUnreadCount ?? 0) + current.clientUnreadCount,
          messageCount: (other?.messageCount ?? 0) + current.messageCount,
          status: "open",
          archivedAt: null,
          updatedAt: input.now,
        },
        { merge: true },
      );
      transaction.update(thread.ref, {
        movedTo: targetId,
        status: "archived",
        archivedAt: input.now,
        studioUnreadCount: 0,
        updatedAt: input.now,
      });
    });
    const messages = await db
      .collection("messages")
      .where("tenantId", "==", input.tenantId)
      .where("conversationId", "==", thread.id)
      .get();
    for (let index = 0; index < messages.docs.length; index += 400) {
      const batch = db.batch();
      for (const message of messages.docs.slice(index, index + 400)) {
        batch.update(message.ref, {
          conversationId: targetId,
          projectId: input.projectId,
          leadId: input.leadId,
        });
      }
      await batch.commit();
    }
    moved.push(targetId);
  }
  return moved;
}
