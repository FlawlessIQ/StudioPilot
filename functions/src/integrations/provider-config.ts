export type OAuthProvider =
  | "google_calendar"
  | "outlook_calendar"
  | "zoom"
  | "dropbox"
  | "docusign"
  | "dropbox_sign"
  | "quickbooks"
  | "stripe";

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export function docusignOAuthBaseUrl(): string {
  return withoutTrailingSlash(
    process.env.DOCUSIGN_OAUTH_BASE_URL || "https://account.docusign.com",
  );
}

export function docusignUserInfoUrl(): string {
  return `${docusignOAuthBaseUrl()}/oauth/userinfo`;
}

export function quickBooksApiBaseUrl(credentialBaseUrl?: string): string {
  return withoutTrailingSlash(
    credentialBaseUrl ||
      process.env.QUICKBOOKS_API_BASE_URL ||
      "https://quickbooks.api.intuit.com",
  );
}

/**
 * Outlook / Microsoft 365. The `common` authority takes both work or school
 * accounts and personal outlook.com ones, which is what the Azure app
 * registration must allow too (docs/booking-integrations.md).
 */
export const MICROSOFT_AUTHORIZE_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
/**
 * Read-only on purpose: busy time is all StudioCue reads from Outlook.
 * offline_access is what returns a refresh token.
 */
export const MICROSOFT_CALENDAR_SCOPES = ["offline_access", "Calendars.Read"] as const;

/**
 * The env prefix a provider's OAuth client id/secret live under. Outlook's are
 * MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET — the Azure app is Microsoft's,
 * not Outlook's, and the same registration would serve any later Graph use.
 */
export function oauthClientPrefix(provider: OAuthProvider): string {
  if (provider === "google_calendar") return "GOOGLE_CALENDAR";
  if (provider === "outlook_calendar") return "MICROSOFT";
  return provider.toUpperCase();
}

/**
 * Microsoft's v2 token endpoint wants the scopes again on a refresh; the
 * others take the grant's own.
 */
export function refreshScope(provider: OAuthProvider): string | null {
  return provider === "outlook_calendar" ? MICROSOFT_CALENDAR_SCOPES.join(" ") : null;
}

export function oauthRefreshTokenUrl(provider: OAuthProvider): string {
  return {
    google_calendar: "https://oauth2.googleapis.com/token",
    outlook_calendar: MICROSOFT_TOKEN_URL,
    zoom: "https://zoom.us/oauth/token",
    dropbox: "https://api.dropboxapi.com/oauth2/token",
    docusign: `${docusignOAuthBaseUrl()}/oauth/token`,
    dropbox_sign: "https://app.hellosign.com/oauth/token?refresh",
    quickbooks:
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    stripe: "https://connect.stripe.com/oauth/token",
  }[provider];
}

export function refreshCredentialsInRequestBody(
  provider: OAuthProvider,
): boolean {
  return (
    provider === "google_calendar" ||
    provider === "outlook_calendar" ||
    provider === "dropbox_sign"
  );
}

export function refreshNeedsClientCredentials(
  provider: OAuthProvider,
): boolean {
  // Stripe Connect credentials are platform-managed and do not use this OAuth
  // refresh path. Dropbox Sign's live refresh endpoint requires client_id and
  // client_secret in the form body even though its public walkthrough only
  // documents grant_type and refresh_token.
  return provider !== "stripe";
}
