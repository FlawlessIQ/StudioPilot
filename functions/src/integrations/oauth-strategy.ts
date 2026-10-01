export type OAuthProvider =
  | "quickbooks"
  | "google_calendar"
  | "outlook_calendar"
  | "docusign"
  | "dropbox_sign"
  | "dropbox"
  | "zoom"
  | "stripe";

const pkceProviders: ReadonlySet<OAuthProvider> = new Set([
  "google_calendar",
  "outlook_calendar",
  "zoom",
]);

export function providerUsesPkce(provider: OAuthProvider): boolean {
  return pkceProviders.has(provider);
}
