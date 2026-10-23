/**
 * What stops when a studio's connection to another app breaks, in its words.
 *
 * FlawlessIQ's Google Calendar stopped accepting StudioCue's sign-in on Oct 12
 * and nothing said so until a test on Oct 15 found it: Today's card read
 * "Reconnect google calendar · Automation is paused", which is easy to scroll
 * past and says nothing about what is going wrong meanwhile. The studio is
 * now emailed once when it breaks (functions/src/integrations/connection-alert.ts)
 * and both say what has stopped.
 *
 * Pure. Copied at functions/src/integrations/connection-alert.ts;
 * tests/connection-alert.test.ts keeps the two equal.
 */
export const CONNECTION_CONSEQUENCES: Record<string, { label: string; stops: string }> = {
  google_calendar: {
    label: "Google Calendar",
    stops: "Calls clients book won't go on your calendar, and your booking links won't offer clients any times until you reconnect.",
  },
  outlook_calendar: {
    label: "Outlook Calendar",
    stops: "Calls clients book won't go on your calendar, and your booking links won't offer clients any times until you reconnect.",
  },
  apple_calendar: {
    label: "Apple Calendar",
    stops: "Calls clients book won't go on your calendar, and your booking links won't offer clients any times until you reconnect.",
  },
  zoom: { label: "Zoom", stops: "New calls won't get a Zoom link, and call summaries won't come back." },
  quickbooks: { label: "QuickBooks", stops: "Invoices won't be created in QuickBooks, and payments won't be marked paid." },
  stripe: { label: "Stripe", stops: "Invoices won't be created in Stripe, and payments won't be marked paid." },
  dropbox: { label: "Dropbox", stops: "Signed agreements and files won't be saved to your Dropbox." },
  dropbox_sign: { label: "Dropbox Sign", stops: "Agreements can't go out for signature through Dropbox Sign." },
  docusign: { label: "Docusign", stops: "Agreements can't go out for signature through Docusign." },
};

export function connectionConsequence(provider: unknown): { label: string; stops: string } {
  const key = typeof provider === "string" ? provider : "";
  return (
    CONNECTION_CONSEQUENCES[key] ?? {
      label: key ? key.replace(/_/g, " ") : "a connected app",
      stops: "StudioCue can't use it until you reconnect.",
    }
  );
}
