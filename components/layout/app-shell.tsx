"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  CircleGauge,
  ContactRound,
  FolderKanban,
  LibraryBig,
  ListTodo,
  Menu,
  Settings,
  Sparkles,
  ChartNoAxesColumn,
  SlidersHorizontal,
  UsersRound,
  X,
} from "lucide-react";
import { GlobalSearch } from "@/components/layout/global-search";
import { PlatformReturnLink } from "@/components/layout/platform-return-link";
import { cn } from "@/lib/utils";
import { AuthBoundary } from "@/features/auth/auth-boundary";
import { SignOutButton } from "@/features/auth/auth-boundary";
import {
  initials,
  useWorkspace,
  WorkspaceProvider,
  workspaceRoleLabel,
} from "@/features/auth/workspace-context";

const navSections = [
  {
    label: "Workspace",
    items: [
      { label: "Home", href: "/studio", icon: CircleGauge },
      { label: "Pipeline", href: "/studio/leads", icon: ContactRound },
      { label: "Projects", href: "/studio/projects", icon: FolderKanban },
      { label: "Calendar", href: "/studio/calendar", icon: CalendarDays },
      { label: "Tasks", href: "/studio/tasks", icon: ListTodo },
      { label: "Clients", href: "/studio/clients", icon: UsersRound },
    ],
  },
  {
    label: "Studio",
    items: [
      {
        label: "Library",
        href: "/studio/library",
        icon: LibraryBig,
      },
      { label: "Reports", href: "/studio/reports", icon: ChartNoAxesColumn },
      {
        label: "Studio setup",
        href: "/studio/setup",
        icon: SlidersHorizontal,
      },
    ],
  },
] as const;

const activeGroups: Record<string, string[]> = {
  Home: ["Dashboard", "Notifications", "Copilot"],
  Pipeline: ["Leads", "Inquiries", "Proposals", "Contracts", "Invoices", "Booking"],
  Projects: [
    "Projects",
    "Questionnaires",
    "Vendors",
    "Crew",
    "Insurance",
    "Schedules",
    "Readiness",
    "Post-production",
    "Delivery",
    "Reviews",
    "Documents",
    "Communications",
  ],
  Tasks: ["Tasks"],
  Calendar: ["Calendar"],
  Clients: ["Clients"],
  Library: ["Library", "Packages", "Workflows"],
  Reports: ["Reports"],
  "Studio setup": ["Studio setup", "Integrations", "Team", "Subscription", "Settings"],
};

export function AppShell({
  children,
  active = "Dashboard",
}: {
  children: React.ReactNode;
  active?: string;
}) {
  return (
    <AuthBoundary area="studio">
      <WorkspaceProvider area="studio">
        <StudioShell active={active}>{children}</StudioShell>
      </WorkspaceProvider>
    </AuthBoundary>
  );
}

function StudioShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active: string;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const workspace = useWorkspace();
  const tenantName = workspace.error ? "Workspace unavailable" : workspace.tenantName;
  const userName = workspace.error ? "Signed-in user" : workspace.userName;
  const staffAllowed = new Set(["Home", "Projects", "Calendar", "Tasks"]);
  const coordinatorExcluded = new Set(["Reports", "Library", "Studio setup"]);
  const canSee = (label: string) => {
    if (workspace.role === "staff_photographer") return staffAllowed.has(label);
    if (workspace.role === "studio_coordinator")
      return !coordinatorExcluded.has(label);
    return true;
  };
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canSee(item.label)),
    }))
    .filter((section) => section.items.length);
  const currentGroup =
    Object.entries(activeGroups).find(([, values]) => values.includes(active))?.[0] ??
    "Home";

  return (
    <div className="ds-root" data-ds-theme="emerald">
      <div className={cn("ds-shell", navigationOpen && "ds-nav-open")}>
        <button
          aria-label="Close navigation"
          className="ds-nav-backdrop"
          onClick={() => setNavigationOpen(false)}
          type="button"
        />
        <aside aria-label="Studio workspace" className="ds-sidebar" id="studio-navigation">
          <div className="ds-brand-row">
            <div className="ds-brand">
              <span className="ds-brand-mark">S</span>
              <span className="ds-brand-word">
                Studio<b>Cue</b>
              </span>
            </div>
            <button
              aria-label="Close navigation"
              className="ds-sidebar-close"
              onClick={() => setNavigationOpen(false)}
              type="button"
            >
              <X size={19} />
            </button>
          </div>

          <Link className="ds-switcher" href="/auth/workspaces" aria-label="Switch workspace">
            <span className="ds-avatar">{initials(tenantName)}</span>
            <span className="ds-switcher-copy">
              <strong>{tenantName}</strong>
              <small>{workspace.tenantPlan || "Studio workspace"}</small>
            </span>
            <ChevronDown size={15} />
          </Link>

          <nav className="ds-nav" aria-label="Studio navigation">
            {visibleSections.map((section) => (
              <div className="ds-nav-section" key={section.label}>
                <span className="ds-nav-label">{section.label}</span>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      href={item.href}
                      key={item.label}
                      onClick={() => setNavigationOpen(false)}
                      className="ds-nav-item"
                      data-active={item.label === currentGroup ? "true" : "false"}
                    >
                      <Icon size={17} strokeWidth={1.8} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <details className="ds-user">
            <summary className="ds-sidebar-foot">
              <span className="ds-avatar ds-avatar-ink">{initials(userName)}</span>
              <span className="ds-switcher-copy">
                <strong>{userName}</strong>
                <small>{workspaceRoleLabel(workspace.role)}</small>
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="ds-user-pop">
              <Link href="/auth/workspaces">Switch workspace</Link>
              {workspace.role === "studio_owner" ? (
                <Link href="/studio/setup">
                  <Settings size={16} /> Studio setup
                </Link>
              ) : null}
              <PlatformReturnLink />
              <SignOutButton className="ds-user-signout" />
            </div>
          </details>
        </aside>

        <div className="ds-main">
          <header className="ds-topbar">
            <button
              aria-controls="studio-navigation"
              aria-expanded={navigationOpen}
              aria-label="Open navigation"
              className="ds-mobile-menu"
              onClick={() => setNavigationOpen(true)}
              type="button"
            >
              <Menu size={20} />
            </button>
            <span className="ds-crumb">
              <b>Workspace ·</b> {active === "Dashboard" ? "Home" : active}
            </span>
            <GlobalSearch />
            <Link
              className="ds-btn ds-btn-ghost ds-btn-sm"
              href="/studio/notifications"
              aria-label="Notifications"
            >
              <Bell size={18} />
            </Link>
            <Link href="/studio/copilot" className="ds-action">
              <Sparkles size={15} /> Ask Copilot
            </Link>
          </header>
          <main className="ds-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
