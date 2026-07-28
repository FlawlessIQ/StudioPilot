import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AdminShell } from "@/components/platform/admin-shell";
import { LiveAdminCollection } from "@/components/platform/live-admin-data";

export default function PlatformAdminPage() {
  return (
    <AdminShell active="Overview">
      <header>
        <div>
          <p className="eyebrow">Platform overview</p>
          <h1>Tenant operations</h1>
          <p>Production tenant and service state, never estimated demo metrics.</p>
        </div>
        <Link className="button button-dark" href="/platform-admin/system-health">
          System health <ArrowUpRight size={15} />
        </Link>
      </header>
      <section>
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Accounts</p>
            <h2>Tenant fleet</h2>
          </div>
        </div>
        <LiveAdminCollection domain="tenants" />
      </section>
      <section>
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Operations</p>
            <h2>Current service health</h2>
          </div>
        </div>
        <LiveAdminCollection domain="health" />
      </section>
    </AdminShell>
  );
}
