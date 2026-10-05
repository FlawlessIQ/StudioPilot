import { platformSecret } from "./platform-secret.js";

/**
 * Zoom's development app, for Marketplace review only.
 *
 * Zoom reviews an *update* by authorizing the app's development client — the
 * one carrying the changes under review — not the production client every
 * studio uses (Marketplace note, 2026-10-02: "we need to authorize the
 * DEVELOPMENT version of your app"). So the reviewer's own test studio, and
 * only that studio, connects through the development client.
 *
 * - `ZOOM_DEV_TENANT_IDS`: comma-separated tenant ids that use it.
 * - `ZOOM_DEV_CLIENT_ID`: the development client id (not secret).
 * - `ZOOM_DEV_CLIENT_SECRET`: read at run time from Secret Manager
 *   (platform-secret.ts), so a deploy never fails for want of it.
 *
 * Every other studio is untouched: with no tenant listed, or either value
 * missing, nothing changes. A credential issued this way records
 * `oauthApp: "development"`, so its refresh goes to the same client.
 */
export const ZOOM_DEVELOPMENT_APP = "development" as const;
export type ZoomOAuthApp = typeof ZOOM_DEVELOPMENT_APP | null;

export function zoomOAuthAppFor(provider: string, tenantId: string | null | undefined): ZoomOAuthApp {
  if (provider !== "zoom" || !tenantId) return null;
  const tenants = (process.env.ZOOM_DEV_TENANT_IDS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return tenants.includes(tenantId) ? ZOOM_DEVELOPMENT_APP : null;
}

export async function zoomDevelopmentClient(): Promise<{ clientId: string; clientSecret: string }> {
  const clientId = process.env.ZOOM_DEV_CLIENT_ID ?? "";
  const clientSecret = clientId ? await platformSecret("ZOOM_DEV_CLIENT_SECRET") : "";
  if (!clientId || !clientSecret) throw new Error("ZOOM_DEVELOPMENT_APP_NOT_CONFIGURED");
  return { clientId, clientSecret };
}
