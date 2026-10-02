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

export type MessageChannel = "email" | "portal";
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
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  firstOutboundAt?: string | null;
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

function latest(current: string | null | undefined, next: string): string {
  return current && current > next ? current : next;
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
    // When each side last spoke, so "who owes the next message" is read from
    // the thread rather than kept by hand (features/inquiries/next-move.ts).
    lastInboundAt: inbound
      ? latest(current?.lastInboundAt, delta.occurredAt)
      : (current?.lastInboundAt ?? null),
    lastOutboundAt: inbound
      ? (current?.lastOutboundAt ?? null)
      : latest(current?.lastOutboundAt, delta.occurredAt),
    // The studio's first word on this thread, for "how fast do we reply".
    firstOutboundAt: current?.firstOutboundAt ?? (inbound ? null : delta.occurredAt),
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
/**
 * The scope a lead's message belongs to once the lead has become a job.
 *
 * A form inquiry's acknowledgement is queued with only a leadId, then the lead
 * converts and its thread moves onto the job (intake/lead-thread.ts). The send
 * lands a moment later, derives the lead-scoped id again and recreates the
 * thread that just moved — so the inbox showed the same couple twice: the
 * studio's "we received your inquiry" in one thread and the couple's inquiry in
 * the other (UI audit, 2026-10-02). A converted lead's messages go to its job.
 */
export async function resolveThreadScope(
  firestore: Firestore,
  scope: { tenantId: string; projectId: string | null; leadId: string | null },
): Promise<{ projectId: string | null; leadId: string | null }> {
  if (scope.projectId || !scope.leadId) return scope;
  const lead = await firestore.doc(`leads/${scope.leadId}`).get().catch(() => null);
  const projectId = lead?.exists && lead.get("tenantId") === scope.tenantId
    ? lead.get("projectId")
    : null;
  return typeof projectId === "string" && projectId
    ? { projectId, leadId: scope.leadId }
    : scope;
}

export async function applyMessageToConversation(
  firestore: Firestore,
  incoming: ConversationDelta,
): Promise<string> {
  const delta = { ...incoming, ...(await resolveThreadScope(firestore, incoming)) };
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
