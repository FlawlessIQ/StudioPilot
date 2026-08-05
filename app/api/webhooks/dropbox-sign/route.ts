import { relayProviderWebhook } from "../provider-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return relayProviderWebhook(request, {
    functionName: "dropboxSignWebhook",
  });
}

export function GET(): Response {
  return new Response("Hello API Event Received", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
