import { AdminShell } from "@/components/platform/admin-shell";
import { LiveAdminCollection } from "@/components/platform/live-admin-data";

export default function UsersPage() {
  return (
    <AdminShell active="Users">
      <header>
        <div>
          <p className="eyebrow">Identity operations</p>
          <h1>Users</h1>
          <p>Cross-tenant identity references; tenant permissions remain membership-scoped.</p>
        </div>
      </header>
      <LiveAdminCollection domain="users" />
    </AdminShell>
  );
}
