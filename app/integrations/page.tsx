import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return (
    <MarketingLayout eyebrow="Provider-connected operations" title="Keep trusted systems authoritative." description="StudioCue coordinates work while accounting, signatures, storage, calendars, meetings, billing, and communications stay with specialist providers.">
      <CapabilityGrid items={[
        { title: "QuickBooks Online", text: "Accounting and hosted payment source of record.", points: ["Customer matching", "Retainer and final invoices", "Payment reconciliation"] },
        { title: "Docusign", text: "Provider-reported signature evidence.", points: ["Templates and envelopes", "Multiple signers", "Completed document storage"] },
        { title: "Google Calendar & Zoom", text: "Consultation and production scheduling.", points: ["Availability checks", "Duplicate-safe events", "No automatic recording"] },
        { title: "Dropbox", text: "Project folder and approved-document operations.", points: ["Configurable root", "Canonical file IDs", "Booking and COI uploads"] },
        { title: "SendGrid & Twilio", text: "Auditable tenant-branded communications.", points: ["Transactional delivery", "Inbound COI routing", "Consent-aware SMS architecture"] },
        { title: "Vertex AI", text: "Structured assistance with deterministic boundaries.", points: ["Extraction and comparison", "Schedule drafting", "Risk explanation"] },
      ]} />
    </MarketingLayout>
  );
}
