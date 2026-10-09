import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PackagesDomainPage } from "@/components/crm/package-page-copy";
import { PendingImportNotice } from "@/components/ai/pending-import-notice";

export const metadata: Metadata = { title: "Packages" };

export default function PackagesPage() {
  return (
    <AppShell active="Packages">
      {/* Described in the studio's trade: a vendor's packages have no coverage or deliverables. */}
      <PackagesDomainPage beforeContent={<PendingImportNotice destination="packages" />} />
    </AppShell>
  );
}
