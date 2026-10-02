import { participantKey, type Conversation } from "@/features/messaging/conversation";

/**
 * One row per conversation with a person about one job.
 *
 * Thread ids are derived from their scope — `lead:` before an inquiry becomes
 * a job, `project:` after — and a lead's thread is moved onto the job when it
 * converts (functions/src/intake/lead-thread.ts). A send that was queued
 * against the lead and landed after the move recreated the lead thread, so the
 * inbox listed the same couple twice: the studio's "we received your inquiry"
 * in one thread and the couple's inquiry in the other, with the default
 * selection on the auto-reply rather than the unread inquiry (UI audit,
 * 2026-10-02). The server no longer splits them (resolveThreadScope); this
 * folds the threads already split, and any a future writer splits, back into
 * one row.
 *
 * Grouped by participant and lead when the thread has one — a job's thread
 * keeps the leadId it was moved from, so the orphan and the job thread share
 * it — otherwise by participant and job. A moved thread (`movedTo`) is a
 * pointer, not a conversation, and is left out.
 *
 * Pure, browser-safe.
 */

export type ThreadGroup = Conversation & {
  /** Every conversation id folded into this row, primary first. */
  memberIds: string[];
};

type GroupInput = Conversation & { movedTo?: unknown };

function groupKey(thread: Conversation): string {
  const who = participantKey(thread.participant);
  if (thread.leadId) return `${who}|lead:${thread.leadId}`;
  if (thread.projectId) return `${who}|project:${thread.projectId}`;
  return `${who}|id:${thread.id}`;
}

export function groupConversations(threads: readonly GroupInput[]): ThreadGroup[] {
  const groups = new Map<string, GroupInput[]>();
  for (const thread of threads) {
    if (typeof thread.movedTo === "string" && thread.movedTo) continue;
    const key = groupKey(thread);
    const members = groups.get(key);
    if (members) members.push(thread);
    else groups.set(key, [thread]);
  }
  const merged: ThreadGroup[] = [];
  for (const members of groups.values()) {
    // The job's thread is the one replies go to; then the newest.
    const ordered = members
      .slice()
      .sort(
        (left, right) =>
          Number(Boolean(right.projectId)) - Number(Boolean(left.projectId)) ||
          right.lastMessageAt.localeCompare(left.lastMessageAt),
      );
    const primary = ordered[0];
    const newest = members
      .slice()
      .sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt))[0];
    const later = (a?: string | null, b?: string | null) =>
      !a ? (b ?? null) : !b ? a : a > b ? a : b;
    merged.push({
      ...primary,
      projectId: ordered.find((member) => member.projectId)?.projectId ?? null,
      participant: {
        contactId:
          ordered.find((member) => member.participant.contactId)?.participant.contactId ?? null,
        email: ordered.find((member) => member.participant.email)?.participant.email ?? null,
        phone: ordered.find((member) => member.participant.phone)?.participant.phone ?? null,
        name: ordered.find((member) => member.participant.name)?.participant.name ?? null,
      },
      channels: [...new Set(members.flatMap((member) => member.channels))].sort(),
      subject: primary.subject ?? newest.subject,
      lastMessageAt: newest.lastMessageAt,
      lastMessagePreview: newest.lastMessagePreview,
      lastMessageDirection: newest.lastMessageDirection,
      lastMessageChannel: newest.lastMessageChannel,
      studioUnreadCount: members.reduce((sum, member) => sum + (member.studioUnreadCount ?? 0), 0),
      clientUnreadCount: members.reduce((sum, member) => sum + (member.clientUnreadCount ?? 0), 0),
      messageCount: members.reduce((sum, member) => sum + (member.messageCount ?? 0), 0),
      lastInboundAt: members.reduce<string | null>(
        (value, member) => later(value, member.lastInboundAt),
        null,
      ),
      lastOutboundAt: members.reduce<string | null>(
        (value, member) => later(value, member.lastOutboundAt),
        null,
      ),
      memberIds: ordered.map((member) => member.id),
    });
  }
  return merged.sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt));
}

/**
 * The thread to open when the studio has not picked one: the newest that is
 * waiting on them, else the newest. Opening the auto-reply while the couple's
 * unread inquiry sat one row below read as "nothing new here".
 */
export function defaultThread<T extends { studioUnreadCount: number }>(
  threads: readonly T[],
): T | null {
  return threads.find((thread) => thread.studioUnreadCount > 0) ?? threads[0] ?? null;
}
