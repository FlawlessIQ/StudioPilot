export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY (2026-10-04): echoes this request's own forwarding headers back
 * to the caller, to measure how many hops App Hosting adds to
 * X-Forwarded-For. Nothing is logged or stored. Removed once measured.
 */
export function GET(request: Request): Response {
  if (new URL(request.url).searchParams.get("key") !== "18ba3ef5915eb86d023fecc5") return new Response(null, { status: 404 });
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return Response.json({
    xForwardedFor: forwarded.split(",").map((hop) => hop.trim()),
    xRealIp: request.headers.get("x-real-ip"),
    forwarded: request.headers.get("forwarded"),
    xFahClientIp: request.headers.get("x-fah-client-ip"),
  });
}
