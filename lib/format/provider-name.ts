/**
 * Provider and enum names, written the way the brand writes them.
 *
 * "quickbooks" is QuickBooks, not Quickbooks; "dropbox_sign" is Dropbox Sign.
 * Getting a partner's own capitalisation wrong on screen reads as carelessness
 * about the integration itself, so the mapping lives in one place rather than
 * being re-derived per surface.
 *
 * Anything unrecognised falls back to title case with underscores removed,
 * which is right for the many internal enums that also flow through here.
 */

const BRANDS: Record<string, string> = {
  quickbooks: "QuickBooks",
  docusign: "DocuSign",
  dropbox_sign: "Dropbox Sign",
  google_calendar: "Google Calendar",
  sendgrid: "SendGrid",
  zoom: "Zoom",
  dropbox: "Dropbox",
  stripe: "Stripe",
  pic_time: "Pic-Time",
  pixieset: "Pixieset",
  shootproof: "ShootProof",
};

export function providerName(value: unknown): string {
  const source = typeof value === "string" ? value : "";
  return (
    BRANDS[source.toLowerCase()] ??
    source
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}
