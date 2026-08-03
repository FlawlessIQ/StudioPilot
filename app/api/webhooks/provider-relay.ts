export const maxProviderWebhookBytes = 2 * 1024 * 1024;

type RelayConfig = {
  functionName: "docusignWebhook" | "dropboxSignWebhook" | "quickbooksWebhook" | "stripeConnectWebhook";
  signatureHeader: "x-docusign-signature-1" | "content-sha256" | "intuit-signature" | "stripe-signature";
  signatureRequiredError:
    | "DOCUSIGN_SIGNATURE_REQUIRED"
    | "DROPBOX_SIGN_SIGNATURE_REQUIRED"
    | "QUICKBOOKS_SIGNATURE_REQUIRED"
    | "STRIPE_CONNECT_SIGNATURE_REQUIRED";
  forwardedHeaders?: readonly string[];
};

async function serviceAuthorization(target: string): Promise<string | null> {
  const { GoogleAuth } = await import("google-auth-library");
  const identityClient = await new GoogleAuth().getIdTokenClient(target);
  const identityHeaders = await identityClient.getRequestHeaders(target);
  return identityHeaders.get("authorization");
}

export async function relayProviderWebhook(
  request: Request,
  config: RelayConfig,
): Promise<Response> {
  const signature = request.headers.get(config.signatureHeader);
  if (!signature) {
    return Response.json(
      { error: config.signatureRequiredError },
      { status: 401 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > maxProviderWebhookBytes
  ) {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > maxProviderWebhookBytes) {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const origin = process.env.FUNCTIONS_HTTPS_ORIGIN;
  if (!origin) {
    return Response.json(
      { error: "FUNCTION_PROXY_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const target = `${origin.replace(/\/$/, "")}/${config.functionName}`;
  const authorization = await serviceAuthorization(target);
  if (!authorization) {
    return Response.json(
      { error: "SERVICE_IDENTITY_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const headers = new Headers({
    authorization,
    "content-type":
      request.headers.get("content-type") ?? "application/json",
    [config.signatureHeader]: signature,
    "x-studiohub-proxy": "app-hosting",
  });
  for (const name of config.forwardedHeaders ?? []) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(target, {
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
