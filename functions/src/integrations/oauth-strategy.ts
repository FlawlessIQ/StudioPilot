export type OAuthProvider =
  | "quickbooks"
  | "google_calendar"
  | "docusign"
  | "dropbox_sign"
  | "dropbox"
  | "zoom";

const pkceProviders: ReadonlySet<OAuthProvider> = new Set([
  "google_calendar",
  "zoom",
]);

export function providerUsesPkce(provider: OAuthProvider): boolean {
  return pkceProviders.has(provider);
}
