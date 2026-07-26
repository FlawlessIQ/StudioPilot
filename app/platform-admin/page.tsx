import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Building2,
  CircleAlert,
  CloudCog,
  CreditCard,
  Flag,
  LifeBuoy,
  ScrollText,
  Users,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { StatusBadge } from "@/components/ui/status-badge";

const adminNav = [
  ["Tenants", Building2],
  ["Users", Users],
  ["Subscriptions", CreditCard],
  ["Integrations", CloudCog],
  ["Failed jobs", CircleAlert],
  ["Feature flags", Flag],
  ["Audit logs", ScrollText],
  ["Support", LifeBuoy],
] as const;

export default function PlatformAdminPage() {
  return (
    <div className="admin-frame">
      <aside className="admin-sidebar">
        <Logo />
        <span className="admin-label">Platform administration</span>
        <nav aria-label="Platform admin navigation">
          {adminNav.map(([label, Icon], index) => (
            <Link className={index === 0 ? "active" : ""} href={`#${label.toLowerCase().replace(" ", "-")}`} key={label}>
              <Icon size={17} /> {label}
              {label === "Failed jobs" ? <i>3</i> : null}
            </Link>
          ))}
        </nav>
        <div className="admin-access-note">
          <ScrollText size={17} />
          <div><strong>Support access is audited</strong><small>Never impersonate casually.</small></div>
        </div>
      </aside>
      <main className="admin-content">
        <header>
          <div><p className="eyebrow">Platform overview</p><h1>Tenant operations</h1></div>
          <StatusBadge tone="success" dot>All systems operational</StatusBadge>
        </header>
        <section className="admin-metrics">
          <article><span>Active tenants</span><strong>148</strong><small>+12 this month</small></article>
          <article><span>Monthly recurring revenue</span><strong>$17.8k</strong><small>4.2% expansion</small></article>
          <article><span>Integration health</span><strong>99.7%</strong><small>Last 24 hours</small></article>
          <article className="warning"><span>Failed jobs</span><strong>3</strong><small>1 requires review</small></article>
        </section>
        <section className="panel admin-table-panel">
          <div className="panel-heading">
            <div><h2>Tenant health</h2><p>Subscription, integrations, and recent activity</p></div>
            <Link href="#tenants">View all tenants <ArrowUpRight size={15} /></Link>
          </div>
          <div className="admin-table">
            {[
              ["Alder & Muse Photography", "Studio", "Healthy", "2 min ago"],
              ["Northlight Creative", "Multi-Brand", "Healthy", "8 min ago"],
              ["Fieldhouse Sports Media", "Studio", "Attention", "22 min ago"],
              ["Morrow Wedding Co.", "Solo", "Healthy", "31 min ago"],
            ].map(([name, plan, health, activity]) => (
              <div className="admin-table-row" key={name}>
                <span className="avatar avatar-sand">{name.charAt(0)}</span>
                <span><strong>{name}</strong><small>{plan}</small></span>
                <StatusBadge tone={health === "Healthy" ? "success" : "warning"} dot>{health}</StatusBadge>
                <span className="activity-cell"><Activity size={14} /> {activity}</span>
                <Link href={`#${name.toLowerCase().replaceAll(" ", "-")}`} aria-label={`Open ${name}`}>
                  <ArrowUpRight size={16} />
                </Link>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
