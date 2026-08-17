import { functionTarget } from "../../function-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxInboundBytes = 1024 * 1024;

async function serviceAuthorization(target: string): Promise<string | null> {
  const { GoogleAuth } = await import("google-auth-library");
  const identityClient = await new GoogleAuth().getIdTokenClient(target);
  const identityHeaders = await identityClient.getRequestHeaders(target);
  return identityHeaders.get("authorization");
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maxInboundBytes)
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > maxInboundBytes)
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const target = functionTarget("sendgridInboundGallery");
  if (!target)
    return Response.json({ error: "FUNCTION_PROXY_NOT_CONFIGURED" }, { status: 503 });
  const authorization = await serviceAuthorization(target);
  if (!authorization)
    return Response.json({ error: "SERVICE_IDENTITY_UNAVAILABLE" }, { status: 503 });
  const targetUrl = new URL(target);
  targetUrl.search = new URL(request.url).search;
  const headers = new Headers({
    authorization,
    "content-type": request.headers.get("content-type") ?? "application/octet-stream",
    "x-studiohub-proxy": "app-hosting",
  });
  const inboundToken = request.headers.get("x-studiohub-inbound-token");
  if (inboundToken) headers.set("x-studiohub-inbound-token", inboundToken);
  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
    redirect: "manual",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers.get("content-type")
      ? { "content-type": upstream.headers.get("content-type")! }
      : undefined,
  });
}

export function GET() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
