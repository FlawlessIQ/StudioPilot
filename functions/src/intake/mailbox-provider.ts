import { resolveMx } from "node:dns/promises";

/**
 * "Where do your inquiries arrive?", answered from the domain's MX records.
 *
 * The forwarding steps differ by provider — a Gmail filter, an Outlook rule,
 * and Microsoft 365 blocks forwarding outside the organisation by default —
 * so setup asks DNS rather than asking the studio a question they may not know
 * the answer to ("is our email Google Workspace?").
 */
export type MailboxProvider =
  | "gmail"
  | "google_workspace"
  | "outlook_com"
  | "microsoft_365"
  | "other";

const CONSUMER: Record<string, MailboxProvider> = {
  "gmail.com": "gmail",
  "googlemail.com": "gmail",
  "outlook.com": "outlook_com",
  "hotmail.com": "outlook_com",
  "live.com": "outlook_com",
  "msn.com": "outlook_com",
};

/** Pure: the provider for a domain, given its MX hosts. */
export function providerFromMx(domain: string, hosts: readonly string[]): MailboxProvider {
  const consumer = CONSUMER[domain.toLowerCase()];
  if (consumer) return consumer;
  const all = hosts.map((host) => host.toLowerCase().replace(/\.$/, ""));
  if (all.some((host) => host.endsWith("google.com") || host.endsWith("googlemail.com"))) {
    return "google_workspace";
  }
  if (all.some((host) => host.endsWith("mail.protection.outlook.com") || host.endsWith("outlook.com"))) {
    return "microsoft_365";
  }
  return "other";
}

export async function detectMailboxProvider(email: string): Promise<{
  domain: string;
  provider: MailboxProvider;
}> {
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!domain) return { domain, provider: "other" };
  if (CONSUMER[domain]) return { domain, provider: CONSUMER[domain] };
  try {
    const records = await resolveMx(domain);
    return { domain, provider: providerFromMx(domain, records.map((record) => record.exchange)) };
  } catch {
    return { domain, provider: "other" };
  }
}
