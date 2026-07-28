import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { VendorCreateForm } from "@/components/planning/vendor-create-form";

export default function VendorsPage() {
  return (
    <AppShell active="Vendors">
      <div className="live-domain-page">
        <StudioDomainPage
          domain="vendors"
          eyebrow="Project network"
          title="Vendors & venues"
          description="Reusable tenant contacts associated only with the projects the signed-in user can access."
        />
        <VendorCreateForm />
      </div>
    </AppShell>
  );
}
