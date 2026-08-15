"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  BriefcaseBusiness,
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
    label: "Workspace",
    items: [
      { label: "Today", href: "/crew", icon: Home },
      { label: "Jobs", href: "/crew/jobs", icon: BriefcaseBusiness },
      { label: "Schedule & prep", href: "/crew/prep", icon: CalendarDays },
      { label: "Account", href: "/crew/account", icon: UserRound },
    ],
  },
] as const;

const CrewShellContext = createContext(false);

const crewRouteLabels: Record<string, string> = {
  accepted: "Jobs",
  account: "Account",
  availability: "Account",
  closeout: "Schedule & prep",
  documents: "Schedule & prep",
  "event-day": "Schedule & prep",
  jobs: "Jobs",
  pending: "Jobs",
  prep: "Schedule & prep",
  profile: "Account",
  requirements: "Schedule & prep",
  schedule: "Schedule & prep",
};

export function CrewPortalShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: string;
}) {
  const shellMounted = useContext(CrewShellContext);
  if (shellMounted) return <>{children}</>;
  return (
    <CrewShellContext.Provider value>
      <WorkspaceProvider area="crew">
        <AuthBoundary area="crew">
          <CrewShell active={active}>{children}</CrewShell>
        </AuthBoundary>
      </WorkspaceProvider>
    </CrewShellContext.Provider>
  );
}

function CrewShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: string;
}) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const workspace = useWorkspace();
  const routeSegment = pathname.split("/").filter(Boolean)[1] ?? "";
  const resolvedActive = active ?? crewRouteLabels[routeSegment] ?? "Today";
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
                      data-active={item.label === resolvedActive ? "true" : "false"}
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
              <b>Crew ·</b> {resolvedActive}
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
