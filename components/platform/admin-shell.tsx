"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  Building2,
  CircleAlert,
  CloudCog,
  CreditCard,
  Flag,
  LifeBuoy,
  Menu,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { PlatformWorkspaceSwitcher } from "@/components/platform/workspace-switcher";
import { AuthBoundary, SignOutButton } from "@/features/auth/auth-boundary";

const nav = [
  ["Overview", "/platform-admin", Activity],
  ["Tenants", "/platform-admin/tenants", Building2],
  ["Users", "/platform-admin/users", Users],
  ["Subscriptions", "/platform-admin/subscriptions", CreditCard],
  ["Integrations", "/platform-admin/integrations", CloudCog],
  ["Failed jobs", "/platform-admin/failed-jobs", CircleAlert],
  ["Feature flags", "/platform-admin/feature-flags", Flag],
  ["Audit logs", "/platform-admin/audit-logs", ScrollText],
  ["Support", "/platform-admin/support", LifeBuoy],
  ["System health", "/platform-admin/system-health", Activity],
] as const;

export function AdminShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active: string;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  return (
    <AuthBoundary area="platform">
      <div className={navigationOpen ? "admin-frame admin-navigation-open" : "admin-frame"}>
        <button
          aria-label="Close navigation"
          className="admin-navigation-backdrop"
          onClick={() => setNavigationOpen(false)}
          type="button"
        />
        <aside className={navigationOpen ? "admin-sidebar admin-sidebar-open" : "admin-sidebar"} id="admin-navigation">
          <div className="admin-sidebar-brand">
            <Link href="/platform-admin" onClick={() => setNavigationOpen(false)}>
              <Logo />
            </Link>
            <button aria-label="Close navigation" className="admin-sidebar-close" onClick={() => setNavigationOpen(false)} type="button">
              <X size={19} />
            </button>
          </div>
          <span className="admin-label">Platform administration</span>
          <PlatformWorkspaceSwitcher />
          <nav aria-label="Platform administration navigation">
            {nav.map(([label, href, Icon]) => (
              <Link
                className={label === active ? "active" : ""}
                href={href}
                key={label}
                onClick={() => setNavigationOpen(false)}
              >
                <Icon size={17} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="admin-access-note">
            <ScrollText />
            <div>
              <strong>Support access is audited</strong>
              <small>Reasoned, time-bounded, revocable.</small>
            </div>
          </div>
        </aside>
        <div className="admin-main">
          <header className="admin-topbar">
            <button
              aria-controls="admin-navigation"
              aria-expanded={navigationOpen}
              aria-label="Open navigation"
              className="mobile-menu"
              onClick={() => setNavigationOpen(true)}
              type="button"
            >
              <Menu size={20} />
            </button>
            <strong>{active}</strong>
            <SignOutButton />
          </header>
          <main className="admin-content">{children}</main>
        </div>
      </div>
    </AuthBoundary>
  );
}
