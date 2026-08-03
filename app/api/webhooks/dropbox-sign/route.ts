import { relayProviderWebhook } from "../provider-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return relayProviderWebhook(request, {
    functionName: "dropboxSignWebhook",
    signatureHeader: "content-sha256",
    signatureRequiredError: "DROPBOX_SIGN_SIGNATURE_REQUIRED",
  });
}

export function GET(): Response {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
