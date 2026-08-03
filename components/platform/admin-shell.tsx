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
      <div className="ds-root" data-ds-theme="emerald">
        <div className={navigationOpen ? "ds-shell ds-nav-open" : "ds-shell"}>
          <button
            aria-label="Close navigation"
            className="ds-nav-backdrop"
            onClick={() => setNavigationOpen(false)}
            type="button"
          />
          <aside className="ds-sidebar" id="admin-navigation">
            <div className="ds-brand-row">
              <Link className="ds-brand" href="/platform-admin" onClick={() => setNavigationOpen(false)}>
                <span className="ds-brand-mark">S</span>
                <span className="ds-brand-word">
                  Studio<b>Cue</b>
                </span>
              </Link>
              <button
                aria-label="Close navigation"
                className="ds-sidebar-close"
                onClick={() => setNavigationOpen(false)}
                type="button"
              >
                <X size={19} />
              </button>
            </div>

            <PlatformWorkspaceSwitcher />

            <nav className="ds-nav" aria-label="Platform administration navigation">
              <div className="ds-nav-section">
                <span className="ds-nav-label">Platform administration</span>
                {nav.map(([label, href, Icon]) => (
                  <Link
                    className="ds-nav-item"
                    data-active={label === active ? "true" : "false"}
                    href={href}
                    key={label}
                    onClick={() => setNavigationOpen(false)}
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            </nav>

            <div className="ds-crew-privacy">
              <ScrollText size={16} />
              <div>
                <strong>Support access is audited</strong>
                <small>Reasoned, time-bounded, revocable.</small>
              </div>
            </div>
          </aside>

          <div className="ds-main">
            <header className="ds-topbar">
              <button
                aria-controls="admin-navigation"
                aria-expanded={navigationOpen}
                aria-label="Open navigation"
                className="ds-mobile-menu"
                onClick={() => setNavigationOpen(true)}
                type="button"
              >
                <Menu size={20} />
              </button>
              <span className="ds-crumb" style={{ marginRight: "auto" }}>
                <b>Platform ·</b> {active}
              </span>
              <SignOutButton className="ds-btn ds-btn-ghost ds-btn-sm" />
            </header>
            <main className="ds-content">{children}</main>
          </div>
        </div>
      </div>
    </AuthBoundary>
  );
}
