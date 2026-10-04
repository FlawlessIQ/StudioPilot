/**
 * The address of whoever sent a request that reached App Hosting.
 *
 * The first `X-Forwarded-For` entry. On 2026-10-04 this briefly took the
 * second entry from the right, on the reading that Google's load balancer
 * appends "<client>, <itself>". App Hosting adds more hops than that: on
 * production the second-from-right entry was 35.219.200.201 — Google's own
 * address — for everyone, which put every visitor in one rate-limit bucket
 * and printed Google's address on audit records. The first entry was the
 * real client (verified against a known address the same day).
 *
 * The first entry can be forged by a client that sends its own header. That
 * is the lesser problem: a forger can reset their own rate limit, where the
 * wrong hop throttles every studio's inquiries together. Taking the right
 * trusted hop needs the exact hop count App Hosting adds, measured, not
 * assumed — tracked in docs/production-status.md.
 */
export function clientIpFromForwardedFor(header: string | null | undefined): string | null {
  const first = (header ?? "").split(",")[0]?.trim();
  return first ? first : null;
}

/** The same, from a request's headers. */
export function requestClientIp(request: Request): string | null {
  return clientIpFromForwardedFor(request.headers.get("x-forwarded-for"));
}
