/**
 * Deciding the audience of a message that predates the `visibility` field.
 *
 * The client portal requires `visibility` to be "client" or "shared" and does
 * not default when it is absent. That is the correct fail-closed behaviour —
 * defaulting a message of unknown audience to "shared" would publish
 * studio-internal notes to clients. The cost is that any message written before
 * the field existed is invisible in the portal while still visible in the studio
 * thread, and the studio has no way to know the client never saw it.
 *
 * So history is decided from evidence, never from a default, under one rule that
 * cannot leak:
 *
 *   **A message already delivered to, or received from, the client cannot be
 *   leaked by showing it to the client.**
 *
 * Anything whose audience is not proven stays internal, which is what it
 * effectively already was.
 *
 * Pure, no I/O.
 */

export type MessageVisibilityDecision = "shared" | "studio";

export type BackfillCandidate = {
  direction?: unknown;
  /** Set by the send path when the recipient is the project's client. */
  recipientIsClient?: unknown;
  contactId?: unknown;
  recipient?: unknown;
  /** Known client addresses on the message's project. */
  clientEmails?: readonly string[];
};

function normalise(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function decideVisibility(
  message: BackfillCandidate,
): MessageVisibilityDecision {
  const direction = String(message.direction ?? "");

  // The client wrote it. They cannot be shown something they sent.
  if (direction === "inbound") return "shared";

  if (direction === "outbound") {
    if (message.recipientIsClient === true) return "shared";

    // A recipient matching one of the project's client contacts proves the mail
    // was already delivered to them.
    const recipient = normalise(message.recipient);
    if (
      recipient &&
      (message.clientEmails ?? []).some(
        (email) => normalise(email) === recipient,
      )
    ) {
      return "shared";
    }

    // A contactId means the send path resolved a client contact for it.
    if (typeof message.contactId === "string" && message.contactId.trim()) {
      return "shared";
    }
  }

  return "studio";
}
