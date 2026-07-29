import { relayProviderWebhook } from "../provider-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return relayProviderWebhook(request, {
    functionName: "quickbooksWebhook",
    signatureHeader: "intuit-signature",
    signatureRequiredError: "QUICKBOOKS_SIGNATURE_REQUIRED",
    forwardedHeaders: [
      "intuit-created-time",
      "intuit-notification-schema-version",
      "intuit-t-id",
    ],
  });
}

export function GET(): Response {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
