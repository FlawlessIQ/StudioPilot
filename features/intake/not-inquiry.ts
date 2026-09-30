/**
 * "Not an inquiry", from the studio's side of the screen.
 *
 * The server decides (functions/src/crm/commands.ts markLeadNotInquiry, and
 * functions/src/intake/ignorable-sender.ts for which senders may be learned).
 * These two answer what a screen needs before the tap: whether the button
 * will work at all, and which address to name in the confirm step.
 */

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Whether "Not an inquiry" will be accepted for a lead with this job.
 *
 * The server files away a lead's job with it only when the job came from the
 * inquiry (`origin: "inquiry"`) and is still at LEAD; a job the studio made by
 * hand, or has moved on, refuses with LEAD_NOT_CONVERTIBLE. Today offered the
 * button on every lead whose job was at LEAD, so a manually made job's lead
 * showed a button that could only fail.
 */
export function notInquiryAllowed(job: Row | null | undefined): boolean {
  if (!job) return true;
  return text(job.origin) === "inquiry" && text(job.state) === "LEAD" && !job.archivedAt;
}

/**
 * The address "not an inquiry" could ignore from now on, to name in the
 * confirm step — or null when there is none to offer.
 *
 * Null for a lead from a known website form or marketplace (`formBuilder`):
 * that address carries every real inquiry, and the server would refuse to
 * learn it anyway. Null too when capture did not record the sender (leads from
 * before it did), or when it is the person's own address.
 */
export function ignorableSenderOf(lead: Row | null | undefined): string | null {
  if (!lead) return null;
  const sender = text(lead.notificationSender).toLowerCase();
  if (!sender.includes("@")) return null;
  const builder = text(lead.formBuilder);
  if (builder && builder !== "unknown") return null;
  if (sender === text(lead.email).toLowerCase()) return null;
  return sender;
}
