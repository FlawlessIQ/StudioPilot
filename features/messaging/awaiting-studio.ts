import {
  studioReplyAtOf,
  type Conversation,
  type MessageChannel,
} from "@/features/messaging/conversation";
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
 * "Owes" is read from the thread: the client spoke after the studio last
 * answered. The studio answers by writing to them — a reply, a composed
 * message, a draft it approved (`lastStudioReplyAt`, moved only when a
 * person at the studio sent it) — by saying "No reply needed" on Today
 * (`noReplyNeededAt`), or by "Replied by email" on the inquiry
 * (`lead.repliedOutsideAt`, as features/inquiries/next-move.ts reads it).
 *
 * What does not answer it: a reminder on a timer ("your questionnaire is due
 * in 3 days" an hour after their question), the inquiry acknowledgement, or
 * opening the thread — reading is not replying. A thread older than
 * `lastStudioReplyAt` is read by its lastOutboundAt, which counted every
 * outbound, as it always had.
 *
 * Threads folded by groupConversations count once.
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
  /** Their messages the studio has not opened yet, across the row. */
  studioUnread: number;
};

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown): string | null => text(value).trim() || null;
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
const later = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : a > b ? a : b;

/** A Firestore row as a Conversation, without trusting any field to be there. */
export function asConversation(row: Row): Conversation & { movedTo?: unknown } {
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
    // Absent (a thread older than the field) is not "never replied": it is
    // read by lastOutboundAt instead (studioReplyAtOf).
    lastStudioReplyAt:
      row.lastStudioReplyAt === undefined ? undefined : textOrNull(row.lastStudioReplyAt),
    noReplyNeededAt: textOrNull(row.noReplyNeededAt),
    status: row.status === "archived" ? "archived" : "open",
    archivedAt: textOrNull(row.archivedAt),
    movedTo: row.movedTo,
  };
}

/** When the studio last answered on one stored conversation. */
function answeredAt(thread: Conversation): string | null {
  return later(studioReplyAtOf(thread), thread.noReplyNeededAt ?? null);
}

export function clientThreadsAwaitingStudio(
  rows: readonly Row[] | null | undefined,
  options: {
    /** For "Replied by email" (lead.repliedOutsideAt) on an inquiry's thread. */
    leads?: readonly Row[] | null;
  } = {},
): ClientThreadAwaitingStudio[] {
  const conversations = (rows ?? []).map(asConversation).filter((thread) => thread.id);
  const byId = new Map(conversations.map((thread) => [thread.id, thread]));
  // "Replied by email" is said about an inquiry, and answers its thread on
  // the lead and on the job it became — the threads next-move.ts reads.
  const repliedOutside = new Map<string, string>();
  for (const lead of options.leads ?? []) {
    const at = textOrNull(lead.repliedOutsideAt);
    if (!at) continue;
    for (const key of [`lead:${text(lead.id)}`, `project:${text(lead.projectId)}`]) {
      if (key.endsWith(":")) continue;
      repliedOutside.set(key, later(repliedOutside.get(key) ?? null, at) ?? at);
    }
  }
  const waiting: ClientThreadAwaitingStudio[] = [];
  for (const thread of groupConversations(conversations)) {
    if (thread.status === "archived") continue;
    const newestInbound = thread.lastMessageDirection === "inbound";
    // Threads older than the per-side fields still say who spoke last.
    const inbound = thread.lastInboundAt || (newestInbound ? thread.lastMessageAt : null);
    if (!inbound) continue;
    let answered: string | null = null;
    for (const id of thread.memberIds) {
      const member = byId.get(id);
      if (member) answered = later(answered, answeredAt(member));
    }
    if (thread.leadId) answered = later(answered, repliedOutside.get(`lead:${thread.leadId}`) ?? null);
    if (thread.projectId) answered = later(answered, repliedOutside.get(`project:${thread.projectId}`) ?? null);
    if (answered && answered >= inbound) continue;
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
      studioUnread: thread.studioUnreadCount,
    });
  }
  return waiting;
}
