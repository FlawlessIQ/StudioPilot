/**
 * Addresses that can never belong to a real person.
 *
 * RFC 2606 / 6761 reserve example.com, .org and .net, and the .test,
 * .example, .invalid and .localhost names, for documentation and testing.
 * Fixtures, seed data and walk-throughs use them, and some reached
 * production records — so live mail went to them, bounced, and counted
 * against the sending reputation every studio shares. Live sending skips
 * them; the job records why.
 */
const RESERVED_DOMAINS = new Set(["example.com", "example.org", "example.net"]);
const RESERVED_SUFFIXES = [".test", ".example", ".invalid", ".localhost"];

export function isReservedTestAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return false;
  if (RESERVED_DOMAINS.has(domain)) return true;
  if ([...RESERVED_DOMAINS].some((reserved) => domain.endsWith(`.${reserved}`))) return true;
  return RESERVED_SUFFIXES.some((suffix) => domain === suffix.slice(1) || domain.endsWith(suffix));
}
