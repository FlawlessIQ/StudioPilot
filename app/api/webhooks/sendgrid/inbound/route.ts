import { functionTarget } from "../../function-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxInboundBytes = 20 * 1024 * 1024;

/**
 * A bare `<slug>@inbound.…` recipient. Only the inbound parse host receives
 * mail here, so any bare local part on it is a studio's short address.
 */
const shortInquiryAddress = /(?:^|[\s,<"';:[])[a-z0-9-]{2,80}@inbound\.[a-z0-9.-]+/i;

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
    const recipients = `${envelope}\n${to}`;
    if (/gallery\+[A-Za-z0-9_-]{20,300}@/i.test(recipients)) {
      functionName = "sendgridInboundGallery";
    } else if (/coi\+[A-Za-z0-9_-]{20,300}@/i.test(recipients)) {
      // A certificate for a request: before any reply+ address on the same
      // message (a reply-all), so the PDF reaches the job's certificate page
      // and not Messages (GR Productions, 2026-10-06).
      functionName = "sendgridInboundCoi";
    } else if (
      /reply\+[A-Za-z0-9_.-]{16,400}@/i.test(recipients) ||
      // A studio replying to the StudioCue team about its feedback (Console
      // inbox); the message function verifies the signature.
      /feedback\+[A-Za-z0-9_-]{19}\.[A-Za-z0-9_-]{11}@/i.test(recipients) ||
      // A studio forwarding an inquiry to its private address. The message
      // function reads `inquiries+<slug>.<signature>` and verifies it.
      /inquiries\+[a-z0-9-]{2,80}\.[A-Za-z0-9_-]{11}@/i.test(recipients)
    ) {
      // A client replying to a studio message. Checked after gallery so the
      // narrower prefixes keep priority, and the COI default stays the fallback
      // for anything unrecognised.
      functionName = "sendgridInboundMessage";
    } else if (
      !/coi\+/i.test(recipients) &&
      shortInquiryAddress.test(recipients)
    ) {
      // The studio's short address, `<slug>@<inbound domain>`. It has no `+`
      // part, so nothing above claims it; the message function resolves the
      // slug and decides how far to trust the sender.
      functionName = "sendgridInboundMessage";
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
