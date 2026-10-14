import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PackagesDomainPage } from "@/components/crm/package-page-copy";

export const metadata: Metadata = { title: "Packages" };

export default function PackagesPage() {
  return (
    <AppShell active="Packages">
      {/* Described in the studio's trade: a vendor's packages have no coverage or deliverables. */}
      {/* The unfinished-import banner lives on Library, the shelf it imports
          to; it was on Library, Packages and Questionnaires at once (laptop
          UI audit, 2026-10-14). */}
      <PackagesDomainPage />
    </AppShell>
  );
}
