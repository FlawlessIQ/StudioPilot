import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "StudioCue connects to QuickBooks Online, Google Calendar, Zoom and Dropbox. Agreements are signed online in StudioCue, and email is built in.",
  alternates: { canonical: "/integrations" },
};

/**
 * Only what a studio can actually connect, or actually use.
 *
 * This page once listed Dropbox Sign, DocuSign and Twilio SMS as available.
 * The two signing providers are built server-side and deliberately not
 * offered (features/integrations/schema.ts, offeredProviders: each costs real
 * money, which waits on revenue), and no SMS send path exists at all.
 *
 * Signing is no longer "coming soon": since 2026-10-02 StudioCue writes and
 * signs contracts itself for every studio (features/contracts/rollout.ts,
 * NATIVE_SIGNING_GENERALLY_AVAILABLE; docs/contracts.md). That is a built-in
 * capability, not a provider to connect, so it sits with email and Cue.
 * Neither signing vendor is named here: a studio cannot connect either.
 *
 * Stripe is not listed. Studios pay StudioCue through Stripe, but per-studio
 * client payments (Stripe Connect) are not offered — client invoices go
 * through QuickBooks. tests/marketing-claims.test.ts checks both claims
 * against the code.
 *
 * SendGrid and Vertex AI are part of StudioCue, not something a studio sets
 * up, so they are described below as what they are.
 */
export default function IntegrationsPage() {
  return (
    <MarketingLayout
      eyebrow="Provider-connected operations"
      title="Keep trusted systems authoritative."
      description="StudioCue coordinates the work. Your accounting, calendar, meetings and file storage stay where they already are, and stay the source of truth. Contracts and email are built in."
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
        ]}
      />
      <CapabilityGrid
        items={[
          {
            title: "Signing, built in",
            text: "Bring in the agreement you already use. When a client accepts a proposal, StudioCue writes their contract from it and they sign online in their portal. No signing app to connect, and no per-contract cost.",
            points: [
              "Contract written from the accepted proposal",
              "Signed copy sealed with a certificate and emailed",
              "Signed another way? Record it and the booking proceeds",
            ],
          },
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
            title: "Cue, built in",
            text: "Cue — StudioCue's assistant — drafts real work, with hard limits on what it may decide.",
            points: [
              "Extraction and comparison",
              "Schedule drafting",
              "Never writes a payment or signature",
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
    </MarketingLayout>
  );
}
