import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Packages · StudioHub" };

export default function PackagesPage() {
  return (
    <AppShell active="Packages">
      <StudioDomainPage
        domain="packages"
        eyebrow="Catalog"
        title="Packages"
        description="Versioned offerings that create immutable project pricing snapshots."
        action={{ href: "/studio/packages/new", label: "Create package" }}
      />
    </AppShell>
  );
}
