"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ClipboardCheck,
  FileText,
  Home,
  Menu,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { AuthBoundary, SignOutButton } from "@/features/auth/auth-boundary";
import {
  initials,
  useWorkspace,
  WorkspaceProvider,
} from "@/features/auth/workspace-context";

const navSections = [
  {
    label: "Assignments",
    items: [
      { label: "Home", href: "/crew", icon: Home },
      { label: "Pending jobs", href: "/crew/pending", icon: ClipboardCheck },
      { label: "Accepted jobs", href: "/crew/accepted", icon: CalendarDays },
      { label: "Schedule", href: "/crew/schedule", icon: CalendarDays },
      { label: "Requirements", href: "/crew/requirements", icon: ClipboardCheck },
      { label: "Documents", href: "/crew/documents", icon: FileText },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/crew/profile", icon: UserRound },
      { label: "Availability", href: "/crew/availability", icon: CalendarDays },
    ],
  },
] as const;

export function CrewPortalShell({
  children,
  active = "Home",
}: {
  children: React.ReactNode;
  active?: string;
}) {
  return (
    <AuthBoundary area="crew">
      <WorkspaceProvider area="crew">
        <CrewShell active={active}>{children}</CrewShell>
      </WorkspaceProvider>
    </AuthBoundary>
  );
}

function CrewShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active: string;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const workspace = useWorkspace();
  return (
    <div className="ds-root" data-ds-theme="emerald">
      <div className={navigationOpen ? "ds-shell ds-nav-open" : "ds-shell"}>
        <button
          aria-label="Close navigation"
          className="ds-nav-backdrop"
          onClick={() => setNavigationOpen(false)}
          type="button"
        />
        <aside className="ds-sidebar" id="crew-navigation">
          <div className="ds-brand-row">
            <Link className="ds-brand" href="/crew" onClick={() => setNavigationOpen(false)}>
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

          <div className="ds-switcher" style={{ cursor: "default" }}>
            <span className="ds-avatar">{initials(workspace.userName)}</span>
            <span className="ds-switcher-copy">
              <strong>{workspace.userName}</strong>
              <small>Subcontractor</small>
            </span>
          </div>

          <nav className="ds-nav" aria-label="Crew portal navigation">
            {navSections.map((section) => (
              <div className="ds-nav-section" key={section.label}>
                <span className="ds-nav-label">{section.label}</span>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      href={item.href}
                      className="ds-nav-item"
                      data-active={item.label === active ? "true" : "false"}
                      key={item.label}
                      onClick={() => setNavigationOpen(false)}
                    >
                      <Icon size={17} strokeWidth={1.8} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="ds-crew-privacy">
            <ShieldCheck size={16} />
            <div>
              <strong>Your assignments stay private</strong>
              <small>
                You only see the jobs, contacts, files, and schedule details shared
                with you.
              </small>
            </div>
          </div>
        </aside>

        <div className="ds-main">
          <header className="ds-topbar">
            <button
              aria-controls="crew-navigation"
              aria-expanded={navigationOpen}
              className="ds-mobile-menu"
              onClick={() => setNavigationOpen(true)}
              type="button"
              aria-label="Open crew navigation"
            >
              <Menu size={20} />
            </button>
            <span className="ds-crumb">
              <b>Crew ·</b> {active}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--ds-muted)" }}>
              {workspace.tenantName}
            </span>
            <SignOutButton className="ds-btn ds-btn-ghost ds-btn-sm" />
          </header>
          <main className="ds-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
