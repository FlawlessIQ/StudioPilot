import { AppShell } from "@/components/layout/app-shell";
import { LiveDomainView } from "@/components/studio/live-domain-view";
import { VendorCreateForm } from "@/components/planning/vendor-create-form";

export default function VendorsPage() {
  return (
    <AppShell active="Vendors">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Project network</p>
            <h1>Vendors & venues</h1>
            <p>
              Keep the contacts, requirements, and project relationships your
              team needs in one operational view.
            </p>
          </div>
        </header>
        <LiveDomainView domain="vendors" />
        <VendorCreateForm />
      </div>
    </AppShell>
  );
}
