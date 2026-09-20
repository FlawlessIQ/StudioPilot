/**
 * An access token for Vertex AI from the function's own runtime identity.
 *
 * Lifted out of copilot.ts so the signed-agreement reader could use it without
 * copilot.ts and its own reader importing each other.
 */
export async function cloudAccessToken(): Promise<string> {
  /**
   * The throw is coded too, not only the non-ok response.
   *
   * `fetch` itself rejects when the metadata server cannot be reached at all —
   * a network blip in production, and every request outside GCP. That rejection
   * is a bare `TypeError: fetch failed`, and the copilot returns an uncoded
   * exception's `.message` straight to the browser, so a studio was shown the
   * words "fetch failed" and nothing else. Found in the 2026-09-20 UX audit.
   */
  let response: Response;
  try {
    response = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } },
    );
  } catch {
    throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  }
  if (!response.ok) throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string")
    throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  return body.access_token;
}
