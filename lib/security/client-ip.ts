/**
 * The address of whoever sent a request that reached App Hosting.
 *
 * Firebase App Hosting sets `x-fah-client-ip` to the connecting client and
 * overwrites any value a client sends — measured on production on
 * 2026-10-04: a request carrying a forged `X-Fah-Client-Ip: 6.6.6.6` and a
 * forged `X-Forwarded-For: 6.6.6.6` arrived with `x-fah-client-ip` set to the
 * real address. `X-Forwarded-For` is "<anything the client sent>, <client>,
 * <Google front end>, <Google proxy>", so its first entry can be forged and
 * its second-from-right is Google's own address for everyone (which briefly
 * put every visitor in one rate-limit bucket the same morning).
 *
 * Off App Hosting — the emulator, a local `next start` — there is no
 * `x-fah-client-ip`, and the first forwarded-for entry is the only answer.
 */
export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  const appHosting = headers.get("x-fah-client-ip")?.split(",")[0]?.trim();
  if (appHosting) return appHosting;
  const first = (headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
  return first ? first : null;
}

/** The same, from a request. */
export function requestClientIp(request: Request): string | null {
  return clientIpFromHeaders(request.headers);
}
