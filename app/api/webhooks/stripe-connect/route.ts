import { relayProviderWebhook } from "../provider-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return relayProviderWebhook(request, {
    functionName: "stripeConnectWebhook",
    signatureHeader: "stripe-signature",
    signatureRequiredError: "STRIPE_CONNECT_SIGNATURE_REQUIRED",
  });
}

export function GET(): Response {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
