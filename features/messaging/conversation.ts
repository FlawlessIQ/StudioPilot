import { z } from "zod";

/**
 * Conversations — the thread the messaging feature never had.
 *
 * Before this, `messages` was a flat log: outbound sends written by the email
 * worker, inbound portal messages written by the portal route, and nothing
 * relating the two. There was no entity to open, mark read, or reply within,
 * which is why the studio screen could only ever be a delivery history.
 *
 * Three separate writers need to agree on which thread a message belongs to —
 * the email worker, the client portal, and (from Phase 3) the inbound email
 * parser. So the thread id is *derived* from the message rather than looked up:
 * each writer computes the same id from the same facts without a query, the way
 * membership documents use `${tenantId}_${userId}`.
 *
 * This module is deterministic and browser-safe: no crypto, no I/O, no Firebase.
 * `functions/src/communications/conversation.ts` mirrors it, following the same
 * convention as `features/booking/agreed-retainer.ts` — this copy is the one
 * with unit tests and is the source of truth.
 */

/**
 * Channels a thread can carry. SMS is deliberately absent: the studio is not set
 * up for Twilio, and a channel the product cannot deliver has no business being
 * in the type or on the screen. The fold, the id derivation and the UI are all
 * channel-agnostic, so adding one back is a union member and a writer — not a
 * migration.
 */
export const messageChannelSchema = z.enum(["email", "portal"]);
export type MessageChannel = z.infer<typeof messageChannelSchema>;

export const messageDirectionSchema = z.enum(["inbound", "outbound"]);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

export const conversationStatusSchema = z.enum(["open", "archived"]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const conversationParticipantSchema = z.object({
  contactId: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  name: z.string().nullable(),
});
export type ConversationParticipant = z.infer<
  typeof conversationParticipantSchema
>;

export const conversationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  projectId: z.string().nullable(),
  leadId: z.string().nullable(),
  participant: conversationParticipantSchema,
  /** Every channel this thread has carried, so one thread spans both. */
  channels: z.array(messageChannelSchema),
  subject: z.string().nullable(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string(),
  lastMessageDirection: messageDirectionSchema,
  lastMessageChannel: messageChannelSchema,
  /** Waiting on the studio. Cleared when the studio reads or replies. */
  studioUnreadCount: z.number().int().nonnegative(),
  /** Waiting on the client, for the portal's own unread badge. */
  clientUnreadCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  status: conversationStatusSchema,
  archivedAt: z.string().nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;

/**
 * The identity a thread is grouped by. Email is lowercased because providers
 * treat the local part case-insensitively in practice and a studio writing
 * "John@" must not open a second thread. Phone numbers keep digits and a
 * leading `+` only, so formatting differences collapse to one participant.
 */
export function participantKey(participant: {
  email?: string | null;
  phone?: string | null;
  contactId?: string | null;
}): string {
  const email = participant.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = participant.phone?.replace(/[^\d+]/g, "");
  if (phone) return `phone:${phone}`;
  const contactId = participant.contactId?.trim();
  if (contactId) return `contact:${contactId}`;
  return "unknown";
}

/**
 * FNV-1a over 64 bits. Deliberately not a crypto hash: this module is imported
 * by browser code, and `node:crypto` would follow it into the client bundle.
 * The id only has to be stable and collision-free across the handful of
 * participants on one project, not unguessable — and it keeps the participant's
 * email out of a document id that shows up in logs and URLs.
 */
function fnv1a64(value: string): string {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Derived, not allocated. A thread is scoped to the project (or the lead, before
 * a project exists) so the same couple emailing about two weddings gets two
 * threads rather than one confusing one.
 */
export function conversationIdFor(input: {
  tenantId: string;
  projectId?: string | null;
  leadId?: string | null;
  participant: { email?: string | null; phone?: string | null; contactId?: string | null };
}): string {
  const scope = input.projectId
    ? `project:${input.projectId}`
    : input.leadId
      ? `lead:${input.leadId}`
      : "unscoped";
  return `conv_${fnv1a64(`${input.tenantId}|${scope}|${participantKey(input.participant)}`)}`;
}

/** One message, as any of the three writers can describe it. */
export type ConversationDelta = {
  tenantId: string;
  projectId: string | null;
  leadId: string | null;
  participant: ConversationParticipant;
  channel: MessageChannel;
  direction: MessageDirection;
  subject: string | null;
  preview: string;
  occurredAt: string;
};

function uniqueChannels(
  existing: readonly MessageChannel[] | undefined,
  channel: MessageChannel,
): MessageChannel[] {
  const set = new Set<MessageChannel>(existing ?? []);
  set.add(channel);
  return [...set].sort();
}

/**
 * Fold a message into its thread. Shared by every writer so the unread counts
 * mean the same thing regardless of which one ran.
 *
 * Unread accounting:
 * - a client message leaves the studio one to answer;
 * - a studio reply clears the studio's count, because replying means it was
 *   read, and leaves one for the client.
 *
 * Ordering: jobs retry, and a retried send can land after a reply that was
 * written later. So "last message" fields only move forward — an older delta
 * still counts toward totals and channels, but cannot rewrite the thread's
 * headline to something stale.
 */
export function foldMessageIntoConversation(
  current: Conversation | null,
  delta: ConversationDelta,
): Conversation {
  const id = conversationIdFor({
    tenantId: delta.tenantId,
    projectId: delta.projectId,
    leadId: delta.leadId,
    participant: delta.participant,
  });
  const isNewer = !current || delta.occurredAt >= current.lastMessageAt;
  const inbound = delta.direction === "inbound";

  return {
    id,
    tenantId: delta.tenantId,
    projectId: delta.projectId,
    leadId: delta.leadId,
    // A later message carries better participant detail than the first one did
    // (a name resolved, a phone added), so fill gaps without discarding.
    participant: {
      contactId: delta.participant.contactId ?? current?.participant.contactId ?? null,
      email: delta.participant.email ?? current?.participant.email ?? null,
      phone: delta.participant.phone ?? current?.participant.phone ?? null,
      name: delta.participant.name ?? current?.participant.name ?? null,
    },
    channels: uniqueChannels(current?.channels, delta.channel),
    subject: (isNewer ? delta.subject : current?.subject) ?? current?.subject ?? null,
    lastMessageAt: isNewer ? delta.occurredAt : current.lastMessageAt,
    lastMessagePreview: isNewer ? delta.preview : current.lastMessagePreview,
    lastMessageDirection: isNewer ? delta.direction : current.lastMessageDirection,
    lastMessageChannel: isNewer ? delta.channel : current.lastMessageChannel,
    studioUnreadCount: inbound ? (current?.studioUnreadCount ?? 0) + 1 : 0,
    clientUnreadCount: inbound ? 0 : (current?.clientUnreadCount ?? 0) + 1,
    messageCount: (current?.messageCount ?? 0) + 1,
    // A thread the studio archived reopens when the client writes again;
    // a studio reply on an archived thread does not resurrect it.
    status: inbound ? "open" : (current?.status ?? "open"),
    archivedAt: inbound ? null : (current?.archivedAt ?? null),
  };
}

/** Studio opened the thread. Separate from replying, which also clears it. */
export function markConversationReadByStudio(
  current: Conversation,
): Conversation {
  return { ...current, studioUnreadCount: 0 };
}

export function markConversationReadByClient(
  current: Conversation,
): Conversation {
  return { ...current, clientUnreadCount: 0 };
}
