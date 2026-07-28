import { AdminShell } from "@/components/platform/admin-shell";
import { LiveAdminCollection } from "@/components/platform/live-admin-data";

export default function TenantsPage() {
  return (
    <AdminShell active="Tenants">
      <header>
        <div>
          <p className="eyebrow">Tenant control</p>
          <h1>Tenants</h1>
          <p>Account status and subscription references without entering tenant data.</p>
        </div>
      </header>
      <LiveAdminCollection domain="tenants" />
    </AdminShell>
  );
}
