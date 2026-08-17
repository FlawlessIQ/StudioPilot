export type OAuthProvider =
  | "google_calendar"
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

export function oauthRefreshTokenUrl(provider: OAuthProvider): string {
  return {
    google_calendar: "https://oauth2.googleapis.com/token",
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
  return provider === "google_calendar";
}

export function refreshNeedsClientCredentials(
  provider: OAuthProvider,
): boolean {
  // Stripe Connect credentials are platform-managed and do not use this OAuth
  // refresh path. Dropbox Sign's refresh endpoint accepts the refresh token
  // without resending the app credentials.
  return provider !== "stripe" && provider !== "dropbox_sign";
}
