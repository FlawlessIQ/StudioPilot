import { relayProviderWebhook } from "../provider-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return relayProviderWebhook(request, {
    functionName: "zoomWebhook",
    signatureHeader: "x-zm-signature",
    signatureRequiredError: "ZOOM_SIGNATURE_REQUIRED",
    forwardedHeaders: ["x-zm-request-timestamp"],
  });
}

export function GET(): Response {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
