/**
 * An access token for Vertex AI from the function's own runtime identity.
 *
 * Lifted out of copilot.ts so the signed-agreement reader could use it without
 * copilot.ts and its own reader importing each other.
 */
export async function cloudAccessToken(): Promise<string> {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string")
    throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  return body.access_token;
}
