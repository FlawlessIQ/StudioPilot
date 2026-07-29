import { relayProviderWebhook } from "../provider-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return relayProviderWebhook(request, {
    functionName: "docusignWebhook",
    signatureHeader: "x-docusign-signature-1",
    signatureRequiredError: "DOCUSIGN_SIGNATURE_REQUIRED",
    forwardedHeaders: ["x-authorization-digest"],
  });
}

export function GET(): Response {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
