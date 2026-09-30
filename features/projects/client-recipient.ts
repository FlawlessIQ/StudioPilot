/**
 * Who a job's client email goes to, for saying so before it goes.
 *
 * The confirm steps in front of a gallery release, a retainer invoice and the
 * final bill name the person who will be emailed (wave 3, 2026-09-30). The
 * server picks the first client contact on the job with a real address
 * (functions/src/operations/provider-runtime.ts `clientEmailFor`); this is
 * the same rule over the records the page already holds, so the name on the
 * button is the name on the email. Pure.
 */

type Row = Record<string, unknown> & { id: string };

export type ClientRecipient = { name: string | null; email: string };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function jobClientRecipient(
  project: Record<string, unknown> | null | undefined,
  contacts: readonly Row[] | null | undefined,
): ClientRecipient | null {
  const ids = Array.isArray(project?.clientContactIds) ? (project.clientContactIds as unknown[]) : [];
  const tenantId = text(project?.tenantId);
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const contact = (contacts ?? []).find((candidate) => candidate.id === id);
    if (!contact) continue;
    // Same tenant only, as the server reads it.
    if (tenantId && text(contact.tenantId) && text(contact.tenantId) !== tenantId) continue;
    const email = text(contact.email);
    if (!email.includes("@")) continue;
    const name =
      text(contact.displayName) ||
      [text(contact.firstName), text(contact.lastName)].filter(Boolean).join(" ") ||
      null;
    return { name, email };
  }
  return null;
}

/** "Ada Lovelace (ada@example.com)", or the address alone. */
export function recipientLabel(recipient: ClientRecipient | null): string | null {
  if (!recipient) return null;
  return recipient.name ? `${recipient.name} (${recipient.email})` : recipient.email;
}
