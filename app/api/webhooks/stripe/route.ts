export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxWebhookBytes = 1024 * 1024;

async function serviceAuthorization(target: string): Promise<string | null> {
  const { GoogleAuth } = await import("google-auth-library");
  const identityClient = await new GoogleAuth().getIdTokenClient(target);
  const identityHeaders = await identityClient.getRequestHeaders(target);
  return identityHeaders.get("authorization");
}

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json(
      { error: "STRIPE_SIGNATURE_REQUIRED" },
      { status: 401 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > maxWebhookBytes
  ) {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > maxWebhookBytes) {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const origin = process.env.FUNCTIONS_HTTPS_ORIGIN;
  if (!origin) {
    return Response.json(
      { error: "FUNCTION_PROXY_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const target = `${origin.replace(/\/$/, "")}/stripeWebhook`;
  const authorization = await serviceAuthorization(target);
  if (!authorization) {
    return Response.json(
      { error: "SERVICE_IDENTITY_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const upstream = await fetch(target, {
    method: "POST",
    headers: {
      authorization,
      "content-type":
        request.headers.get("content-type") ?? "application/json",
      "stripe-signature": signature,
      "x-studiohub-proxy": "app-hosting",
    },
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
