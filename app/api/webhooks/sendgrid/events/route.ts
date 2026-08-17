import { functionTarget } from "../../function-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maxBytes = 2 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("x-twilio-email-event-webhook-signature");
  const timestamp = request.headers.get("x-twilio-email-event-webhook-timestamp");
  if (!signature || !timestamp)
    return Response.json({ error: "SIGNATURE_REQUIRED" }, { status: 401 });
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes)
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const target = functionTarget("sendgridEventWebhook");
  if (!target)
    return Response.json({ error: "FUNCTION_PROXY_NOT_CONFIGURED" }, { status: 503 });
  const { GoogleAuth } = await import("google-auth-library");
  const client = await new GoogleAuth().getIdTokenClient(target);
  const authorization = (await client.getRequestHeaders(target)).get("authorization");
  if (!authorization)
    return Response.json({ error: "SERVICE_IDENTITY_UNAVAILABLE" }, { status: 503 });
  const upstream = await fetch(target, {
    method: "POST",
    headers: {
      authorization,
      "content-type": request.headers.get("content-type") ?? "application/json",
      "x-twilio-email-event-webhook-signature": signature,
      "x-twilio-email-event-webhook-timestamp": timestamp,
      "x-studiohub-proxy": "app-hosting",
    },
    body,
    cache: "no-store",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
