/**
 * Conversation threading — the deterministic half.
 *
 * `features/messaging/conversation.ts` is the source of truth; functions/ is a
 * separate package with its own tsconfig and cannot import from features/, so
 * this mirrors it, the same way functions/src/booking/agreed-retainer.ts mirrors
 * features/booking/agreed-retainer.ts. The features/ copy is the one with unit
 * test coverage (`npm test`) — change it there first, then bring this in line.
 *
 * Only the parts the server needs are mirrored: the id derivation and the fold.
 * Zod validation of a stored conversation stays on the features/ side.
 */

import type { Firestore } from "firebase-admin/firestore";

export type MessageChannel = "email" | "portal" | "sms";
export type MessageDirection = "inbound" | "outbound";

export type ConversationParticipant = {
  contactId: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
};

export type Conversation = {
  id: string;
  tenantId: string;
  projectId: string | null;
  leadId: string | null;
  participant: ConversationParticipant;
  channels: MessageChannel[];
  subject: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageDirection: MessageDirection;
  lastMessageChannel: MessageChannel;
  studioUnreadCount: number;
  clientUnreadCount: number;
  messageCount: number;
  status: "open" | "archived";
  archivedAt: string | null;
};

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

export function conversationIdFor(input: {
  tenantId: string;
  projectId?: string | null;
  leadId?: string | null;
  participant: {
    email?: string | null;
    phone?: string | null;
    contactId?: string | null;
  };
}): string {
  const scope = input.projectId
    ? `project:${input.projectId}`
    : input.leadId
      ? `lead:${input.leadId}`
      : "unscoped";
  return `conv_${fnv1a64(
    `${input.tenantId}|${scope}|${participantKey(input.participant)}`,
  )}`;
}

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
  const channels = new Set<MessageChannel>(current?.channels ?? []);
  channels.add(delta.channel);

  return {
    id,
    tenantId: delta.tenantId,
    projectId: delta.projectId,
    leadId: delta.leadId,
    participant: {
      contactId:
        delta.participant.contactId ?? current?.participant.contactId ?? null,
      email: delta.participant.email ?? current?.participant.email ?? null,
      phone: delta.participant.phone ?? current?.participant.phone ?? null,
      name: delta.participant.name ?? current?.participant.name ?? null,
    },
    channels: [...channels].sort(),
    subject:
      (isNewer ? delta.subject : current?.subject) ?? current?.subject ?? null,
    lastMessageAt: isNewer ? delta.occurredAt : current.lastMessageAt,
    lastMessagePreview: isNewer ? delta.preview : current.lastMessagePreview,
    lastMessageDirection: isNewer
      ? delta.direction
      : current.lastMessageDirection,
    lastMessageChannel: isNewer ? delta.channel : current.lastMessageChannel,
    studioUnreadCount: inbound ? (current?.studioUnreadCount ?? 0) + 1 : 0,
    clientUnreadCount: inbound ? 0 : (current?.clientUnreadCount ?? 0) + 1,
    messageCount: (current?.messageCount ?? 0) + 1,
    status: inbound ? "open" : (current?.status ?? "open"),
    archivedAt: inbound ? null : (current?.archivedAt ?? null),
  };
}

/**
 * Upsert helper shared by the writers. Runs in a transaction because two
 * messages on one thread can land concurrently — a client reply arriving while
 * a lifecycle send completes — and unread counts computed from a stale read
 * would lose one of them.
 */
export async function applyMessageToConversation(
  firestore: Firestore,
  delta: ConversationDelta,
): Promise<string> {
  const id = conversationIdFor({
    tenantId: delta.tenantId,
    projectId: delta.projectId,
    leadId: delta.leadId,
    participant: delta.participant,
  });
  const reference = firestore.doc(`conversations/${id}`);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists
      ? (snapshot.data() as Conversation)
      : null;
    const next = foldMessageIntoConversation(current, delta);
    transaction.set(
      reference,
      { ...next, updatedAt: delta.occurredAt },
      { merge: true },
    );
  });
  return id;
}
