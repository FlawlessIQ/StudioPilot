import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = { title: "Integrations" };

/**
 * Only what a studio can actually connect.
 *
 * This page listed Dropbox Sign, DocuSign and Twilio SMS as available. The
 * two signing providers are built and deliberately withdrawn from the UI, and
 * no SMS send path exists at all — so a photographer choosing StudioCue to
 * sign contracts would have found out after paying. They are marked as coming
 * soon now, which is still worth saying and is true.
 *
 * SendGrid moved off the list entirely: it carries every email the platform
 * sends, but a studio never connects it, so it does not belong on a page
 * about their providers. Same for Vertex AI. Both are described below as what
 * they are — part of StudioCue, not something to go and set up.
 */
export default function IntegrationsPage() {
  return (
    <MarketingLayout
      eyebrow="Provider-connected operations"
      title="Keep trusted systems authoritative."
      description="StudioCue coordinates the work. Your accounting, calendar, meetings and file storage stay where they already are, and stay the source of truth."
    >
      <CapabilityGrid
        items={[
          {
            title: "QuickBooks Online",
            text: "Accounting and hosted payment source of record.",
            points: [
              "Customer matching",
              "Retainer and final invoices",
              "Payment reconciliation",
            ],
          },
          {
            title: "Google Calendar",
            text: "Real availability, so a consultation is never offered on a date you are already working.",
            points: [
              "Free/busy availability checks",
              "Consultation and production events",
              "Duplicate-safe writes",
            ],
          },
          {
            title: "Zoom",
            text: "Consultation meetings created with the booking, not after it.",
            points: [
              "Meeting links on confirmation",
              "Waiting room enforced",
              "No automatic recording",
            ],
          },
          {
            title: "Dropbox",
            text: "Project folders and approved-document operations.",
            points: [
              "Configurable root folder",
              "Canonical file IDs",
              "Booking and COI uploads",
            ],
          },
          {
            title: "E-signature",
            badge: "Coming soon",
            text: "Dropbox Sign and DocuSign are built and being readied. Until they are, StudioCue does not leave you stuck: record a signature taken any other way and the booking proceeds, with the record naming who vouched for it and when.",
            points: [
              "Reusable agreement templates",
              "Provider-verified completion",
              "Manual attestation available today",
            ],
          },
          {
            title: "SMS",
            badge: "Coming soon",
            text: "Text reminders for crew and clients, with consent handled properly. Email carries all of it today.",
            points: [
              "Consent captured before sending",
              "Crew call-time reminders",
              "Delivery recorded on the job",
            ],
          },
        ]}
      />
      <CapabilityGrid
        items={[
          {
            title: "Email, built in",
            text: "Every proposal, contract, invoice and reminder goes out in your studio's name. Nothing to connect.",
            points: [
              "Tenant-branded templates",
              "Delivery recorded against the job",
              "Client replies land on the thread",
            ],
          },
          {
            title: "AI, built in",
            text: "Real help drafting, with hard limits on what it may decide.",
            points: [
              "Extraction and comparison",
              "Schedule drafting",
              "Never writes a payment or signature",
            ],
          },
        ]}
      />
    </MarketingLayout>
  );
}
