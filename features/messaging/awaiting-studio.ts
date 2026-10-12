import type { Conversation, MessageChannel } from "@/features/messaging/conversation";
import { groupConversations } from "@/features/messaging/thread-groups";

/**
 * Client threads where the studio owes the next word.
 *
 * A booked client's portal message reached Messages ("1 waiting on you") and
 * the bell's generic "Client message received" task, and nowhere else: Today
 * said there was nothing to do (Priya Shah, Jess Styles Bridal, prod walk
 * 2026-10-12). Crew messages got their Today card in bee97ad0; this is the
 * same reading for clients.
 *
 * "Owes" is read from the thread, as features/inquiries/next-move.ts does: the
 * client spoke after the studio last replied. An automatic send that is not
 * the studio speaking (the inquiry acknowledgement, `countsAsReply: false`)
 * does not answer it. Opening the thread does not either — reading is not
 * replying. Threads folded by groupConversations count once.
 *
 * Pure, browser-safe. The caller decides which of these Today shows.
 */

export type ClientThreadAwaitingStudio = {
  /** The row's primary conversation — the one replies go to. */
  threadId: string;
  /** Every conversation folded into the row. */
  memberIds: string[];
  projectId: string | null;
  leadId: string | null;
  participant: Conversation["participant"];
  /** When the client wrote what is waiting. */
  waitingSince: string;
  /** The client's words, when theirs is the newest message. */
  preview: string | null;
  subject: string | null;
  /** How the newest message came in, when it is theirs. */
  channel: MessageChannel | null;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown): string | null => text(value).trim() || null;
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** A Firestore row as a Conversation, without trusting any field to be there. */
export function asConversation(row: Record<string, unknown>): Conversation & { movedTo?: unknown } {
  const participant =
    row.participant && typeof row.participant === "object"
      ? (row.participant as Record<string, unknown>)
      : {};
  const channel = (value: unknown): MessageChannel => (value === "portal" ? "portal" : "email");
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    projectId: textOrNull(row.projectId),
    leadId: textOrNull(row.leadId),
    participant: {
      contactId: textOrNull(participant.contactId),
      email: textOrNull(participant.email),
      phone: textOrNull(participant.phone),
      name: textOrNull(participant.name),
    },
    channels: Array.isArray(row.channels) ? row.channels.map(channel) : [],
    subject: textOrNull(row.subject),
    lastMessageAt: text(row.lastMessageAt),
    lastMessagePreview: text(row.lastMessagePreview),
    lastMessageDirection: row.lastMessageDirection === "inbound" ? "inbound" : "outbound",
    lastMessageChannel: channel(row.lastMessageChannel),
    studioUnreadCount: count(row.studioUnreadCount),
    clientUnreadCount: count(row.clientUnreadCount),
    messageCount: count(row.messageCount),
    lastInboundAt: textOrNull(row.lastInboundAt),
    lastOutboundAt: textOrNull(row.lastOutboundAt),
    status: row.status === "archived" ? "archived" : "open",
    archivedAt: textOrNull(row.archivedAt),
    movedTo: row.movedTo,
  };
}

export function clientThreadsAwaitingStudio(
  rows: readonly Record<string, unknown>[] | null | undefined,
): ClientThreadAwaitingStudio[] {
  const threads = groupConversations((rows ?? []).map(asConversation).filter((thread) => thread.id));
  const waiting: ClientThreadAwaitingStudio[] = [];
  for (const thread of threads) {
    if (thread.status === "archived") continue;
    const newestInbound = thread.lastMessageDirection === "inbound";
    // Threads older than the per-side fields still say who spoke last.
    const inbound = thread.lastInboundAt || (newestInbound ? thread.lastMessageAt : null);
    const outbound = thread.lastOutboundAt || null;
    if (!inbound || (outbound && outbound >= inbound)) continue;
    waiting.push({
      threadId: thread.id,
      memberIds: thread.memberIds,
      projectId: thread.projectId,
      leadId: thread.leadId,
      participant: thread.participant,
      waitingSince: inbound,
      preview: newestInbound ? thread.lastMessagePreview.replace(/\s+/g, " ").trim() || null : null,
      subject: thread.subject,
      channel: newestInbound ? thread.lastMessageChannel : null,
    });
  }
  return waiting;
}
