/**
 * The address of whoever sent a request that reached App Hosting.
 *
 * App Hosting sits behind Google's external Application Load Balancer, which
 * appends two entries to `X-Forwarded-For`: the address it accepted the
 * connection from, then its own. Anything before those two was sent by the
 * client and can say anything at all — and every route here read the
 * *first* entry, so a rate limit could be reset, and the address printed on a
 * signing certificate could be chosen, by sending one header.
 *
 * So the client is the second entry from the right. A request that arrives
 * with a single entry (straight to the Cloud Run URL, or the emulator) is
 * taken as it is.
 */
export function clientIpFromForwardedFor(header: string | null | undefined): string | null {
  const hops = (header ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (!hops.length) return null;
  return hops.length >= 2 ? hops[hops.length - 2] : hops[0];
}

/** The same, from a request's headers. */
export function requestClientIp(request: Request): string | null {
  return clientIpFromForwardedFor(request.headers.get("x-forwarded-for"));
}
