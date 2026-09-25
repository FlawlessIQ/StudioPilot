/**
 * Gmail's forwarding confirmation.
 *
 * Before Gmail forwards to an address outside the studio's domain, it emails
 * that address a confirmation code and link. That email arrives at the
 * studio's StudioCue inquiry address, where the studio can't see it. Setup
 * shows the code and the link the moment it lands, so the studio confirms in
 * one step without hunting for an email they will never receive.
 *
 * The link is not followed server-side: it opens a confirmation page in the
 * studio's own Google session, and a server fetch cannot complete it. Showing
 * it is the honest version of "we confirm it for you".
 */
export function gmailForwardingConfirmation(input: {
  from: string;
  subject: string;
  text: string;
}): { code: string | null; link: string | null; forAddress: string | null } | null {
  if (!/forwarding-noreply@google\.com$/i.test(input.from)) return null;
  if (!/forwarding confirmation/i.test(input.subject)) return null;
  const code = /\(#?(\d{6,12})\)/.exec(input.subject)?.[1] ?? /confirmation code:\s*(\d{6,12})/i.exec(input.text)?.[1] ?? null;
  const link = /(https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s"'<>]+)/i.exec(input.text)?.[1] ?? null;
  const forAddress = /Receive (?:Mail|mail) from\s+(\S+@\S+)/i.exec(input.subject)?.[1]?.toLowerCase() ??
    /\b([^\s@]+@[^\s@]+\.[a-z]{2,})\s+has requested to automatically forward/i.exec(input.text)?.[1]?.toLowerCase() ?? null;
  return { code, link, forAddress };
}
