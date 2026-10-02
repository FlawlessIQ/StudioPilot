/**
 * Whose move it is on an inquiry, read from the thread.
 *
 * StudioCue never recorded that a reply had gone out: approving an inquiry
 * reply sent the email and touched nothing on the lead, so after a reload
 * Today showed the answered couple as "New inquiry" again, then as overdue.
 * The conversation already knows — each message moves `lastInboundAt` or
 * `lastOutboundAt` — so the state is derived here rather than stored by hand,
 * where it would drift the first time someone replied from Messages instead
 * of Today.
 *
 * Pure. The caller supplies the tenant's conversations.
 */

export type InquiryConversation = Record<string, unknown> & {
  projectId?: unknown;
  leadId?: unknown;
  movedTo?: unknown;
  lastMessageAt?: unknown;
  lastMessageDirection?: unknown;
  lastInboundAt?: unknown;
  lastOutboundAt?: unknown;
};

export type InquiryNextMove = {
  /** Who owes the next message: the studio, or the couple. */
  owner: "studio" | "couple";
  /** The studio has written to them at least once. */
  replied: boolean;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** Since when the current owner has owed that message. */
  waitingSince: string | null;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const later = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);

/**
 * `receivedAt` is when the inquiry arrived: before any thread exists (a form
 * inquiry a moment old), the studio owes the first reply from then.
 *
 * `repliedOutsideAt` is the studio saying it answered from its own inbox
 * (the lead's `repliedOutsideAt`, set by "Replied by email" on Today).
 * StudioCue can't see that inbox, so it counts as a reply sent then.
 */
export function inquiryNextMove(input: {
  conversations: readonly InquiryConversation[];
  projectId?: string | null;
  leadId?: string | null;
  receivedAt?: string | null;
  repliedOutsideAt?: string | null;
}): InquiryNextMove {
  let lastInboundAt: string | null = null;
  let lastOutboundAt: string | null = input.repliedOutsideAt || null;
  for (const conversation of input.conversations) {
    if (text(conversation.movedTo)) continue;
    const onJob = input.projectId && text(conversation.projectId) === input.projectId;
    const onLead = input.leadId && text(conversation.leadId) === input.leadId;
    if (!onJob && !onLead) continue;
    // Threads written before the per-side fields existed still say which
    // side spoke last, and when.
    const lastAt = text(conversation.lastMessageAt) || null;
    const direction = text(conversation.lastMessageDirection);
    const inbound = text(conversation.lastInboundAt) || (direction === "inbound" ? lastAt : null);
    const outbound = text(conversation.lastOutboundAt) || (direction === "outbound" ? lastAt : null);
    lastInboundAt = later(lastInboundAt, inbound);
    lastOutboundAt = later(lastOutboundAt, outbound);
  }
  const coupleOwes = Boolean(lastOutboundAt && (!lastInboundAt || lastOutboundAt >= lastInboundAt));
  return {
    owner: coupleOwes ? "couple" : "studio",
    replied: Boolean(lastOutboundAt),
    lastInboundAt,
    lastOutboundAt,
    waitingSince: coupleOwes ? lastOutboundAt : (lastInboundAt ?? input.receivedAt ?? null),
  };
}
