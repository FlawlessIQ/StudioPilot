import { functionTarget } from "../../function-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxInboundBytes = 20 * 1024 * 1024;

async function serviceAuthorization(target: string): Promise<string | null> {
  const { GoogleAuth } = await import("google-auth-library");
  const identityClient = await new GoogleAuth().getIdTokenClient(target);
  const identityHeaders = await identityClient.getRequestHeaders(target);
  return identityHeaders.get("authorization");
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > maxInboundBytes
  ) {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const inspectionRequest = request.clone();
  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > maxInboundBytes) {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  let functionName = "sendgridInboundCoi";
  try {
    const fields = await inspectionRequest.formData();
    const envelope = String(fields.get("envelope") ?? "");
    const to = String(fields.get("to") ?? "");
    if (/gallery\+[A-Za-z0-9_-]{20,300}@/i.test(`${envelope}\n${to}`)) {
      functionName = "sendgridInboundGallery";
    }
  } catch {
    // Preserve the existing COI path when SendGrid sends an unreadable payload.
  }

  const target = functionTarget(functionName);
  if (!target) {
    return Response.json(
      { error: "FUNCTION_PROXY_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  const authorization = await serviceAuthorization(target);
  if (!authorization) {
    return Response.json(
      { error: "SERVICE_IDENTITY_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(target);
  targetUrl.search = incomingUrl.search;
  const headers = new Headers({
    authorization,
    "content-type":
      request.headers.get("content-type") ?? "application/octet-stream",
    "x-studiohub-proxy": "app-hosting",
  });
  const inboundToken = request.headers.get("x-studiohub-inbound-token");
  if (inboundToken) {
    headers.set("x-studiohub-inbound-token", inboundToken);
  }

  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: rawBody,
    cache: "no-store",
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export function GET(): Response {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
