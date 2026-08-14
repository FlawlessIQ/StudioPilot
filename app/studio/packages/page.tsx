import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { PendingImportNotice } from "@/components/ai/pending-import-notice";

export const metadata: Metadata = { title: "Packages" };

export default function PackagesPage() {
  return (
    <AppShell active="Packages">
      <StudioDomainPage
        domain="packages"
        eyebrow="Catalog"
        title="Packages"
        description="Build reusable offers with pricing, coverage, deliverables, and add-ons. Existing project prices never change."
        action={{ href: "/studio/packages/new", label: "Create package" }}
        beforeContent={<PendingImportNotice destination="packages" />}
      />
    </AppShell>
  );
}
