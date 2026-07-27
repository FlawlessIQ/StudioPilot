export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serviceAuthorization(target: string): Promise<string | null> {
  const { GoogleAuth } = await import("google-auth-library");
  const identityClient = await new GoogleAuth().getIdTokenClient(target);
  const identityHeaders = await identityClient.getRequestHeaders(target);
  return identityHeaders.get("authorization");
}

export async function GET(request: Request): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const state = incomingUrl.searchParams.get("state");
  const code = incomingUrl.searchParams.get("code");
  const providerError = incomingUrl.searchParams.get("error");
  if (
    !state ||
    state.length > 300 ||
    ((!code || code.length > 4096) && !providerError)
  ) {
    return Response.json({ error: "OAUTH_CALLBACK_INVALID" }, { status: 400 });
  }

  const origin = process.env.FUNCTIONS_HTTPS_ORIGIN;
  if (!origin) {
    return Response.json(
      { error: "FUNCTION_PROXY_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const target = `${origin.replace(/\/$/, "")}/integrationOAuth`;
  const authorization = await serviceAuthorization(target);
  if (!authorization) {
    return Response.json(
      { error: "SERVICE_IDENTITY_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const targetUrl = new URL(target);
  targetUrl.search = incomingUrl.search;
  const upstream = await fetch(targetUrl, {
    method: "GET",
    headers: {
      authorization,
      "x-studiohub-proxy": "app-hosting",
    },
    cache: "no-store",
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  const location = upstream.headers.get("location");
  if (location) {
    const redirectUrl = new URL(location, incomingUrl.origin);
    const appOrigin = new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? incomingUrl.origin,
    ).origin;
    if (redirectUrl.origin !== appOrigin) {
      return Response.json(
        { error: "OAUTH_REDIRECT_REJECTED" },
        { status: 502 },
      );
    }
    responseHeaders.set("location", redirectUrl.toString());
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export function POST(): Response {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
