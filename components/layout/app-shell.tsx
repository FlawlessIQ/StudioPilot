"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { Logo } from "@/components/brand/logo";
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

const StudioShellContext = createContext(false);

const studioRouteLabels: Record<string, string> = {
  audit: "Workflows",
  automations: "Workflows",
  booking: "Booking",
  calendar: "Calendar",
  clients: "Clients",
  contracts: "Contracts",
  copilot: "Copilot",
  crew: "Crew",
  delivery: "Delivery",
  documents: "Documents",
  insurance: "Insurance",
  integrations: "Integrations",
  invoices: "Invoices",
  leads: "Inquiries",
  library: "Library",
  messages: "Communications",
  notifications: "Notifications",
  packages: "Packages",
  "post-production": "Post-production",
  projects: "Projects",
  proposals: "Proposals",
  questionnaires: "Questionnaires",
  readiness: "Readiness",
  reports: "Reports",
  reviews: "Reviews",
  schedules: "Schedules",
  settings: "Settings",
  setup: "Studio setup",
  subscription: "Subscription",
  tasks: "Tasks",
  team: "Team",
  vendors: "Vendors",
  workflows: "Workflows",
};

export function AppShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: string;
}) {
  const shellMounted = useContext(StudioShellContext);
  if (shellMounted) return <>{children}</>;
  return (
    <StudioShellContext.Provider value>
      <WorkspaceProvider area="studio">
        <AuthBoundary area="studio">
          <StudioShell active={active}>{children}</StudioShell>
        </AuthBoundary>
      </WorkspaceProvider>
    </StudioShellContext.Provider>
  );
}

function StudioShell({
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
  const resolvedActive =
    active ?? studioRouteLabels[routeSegment] ?? "Dashboard";
  const tenantName = workspace.error ? "Workspace unavailable" : workspace.tenantName;
  const userName = workspace.error ? "Signed-in user" : workspace.userName;
  const staffAllowed = new Set([
    "Home",
    "Projects",
    "Calendar",
    "Tasks",
  ]);
  const coordinatorExcluded = new Set([
    "Reports",
    "Library",
    "Studio setup",
  ]);
  const canSee = (label: string) => {
    if (workspace.role === "staff_photographer")
      return staffAllowed.has(label);
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
    Object.entries(activeGroups).find(([, values]) =>
      values.includes(resolvedActive),
    )?.[0] ??
    "Home";
  return (
    <div className={cn("app-frame", navigationOpen && "navigation-is-open")}>
      <button
        aria-label="Close navigation"
        className="navigation-backdrop"
        onClick={() => setNavigationOpen(false)}
        type="button"
      />
      <aside
        aria-label="Studio workspace"
        className={cn("sidebar", navigationOpen && "sidebar-open")}
        id="studio-navigation"
      >
        <div className="sidebar-brand">
          <Logo />
          <button
            aria-label="Close navigation"
            className="sidebar-close"
            onClick={() => setNavigationOpen(false)}
            type="button"
          >
            <X size={19} />
          </button>
        </div>
        <Link className="tenant-switcher" href="/auth/workspaces" aria-label="Switch workspace">
          <span className="avatar avatar-sand">{initials(tenantName)}</span>
          <span className="tenant-copy">
            <strong>{tenantName}</strong>
            <small>{workspace.tenantPlan || "Studio workspace"}</small>
          </span>
          <ChevronDown size={15} />
        </Link>

        <nav className="main-nav" aria-label="Studio navigation">
          {visibleSections.map((section) => (
            <div className="nav-section" key={section.label}>
              <span className="nav-section-label">{section.label}</span>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    href={item.href}
                    key={item.label}
                    onClick={() => setNavigationOpen(false)}
                    className={cn(
                      "nav-item",
                      item.label === currentGroup && "nav-active",
                    )}
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <details className="user-menu">
            <summary className="user-card">
              <span className="avatar avatar-ink">{initials(userName)}</span>
              <span className="tenant-copy">
                <strong>{userName}</strong>
                <small>{workspaceRoleLabel(workspace.role)}</small>
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="user-menu-popover">
              <Link href="/auth/workspaces">Switch workspace</Link>
              {workspace.role === "studio_owner" ? (
                <Link href="/studio/setup">
                  <Settings size={16} /> Studio setup
                </Link>
              ) : null}
              <PlatformReturnLink />
              <SignOutButton className="user-menu-signout" />
            </div>
          </details>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button
            aria-controls="studio-navigation"
            aria-expanded={navigationOpen}
            aria-label="Open navigation"
            className="mobile-menu"
            onClick={() => setNavigationOpen(true)}
            type="button"
          >
            <Menu size={20} />
          </button>
          <span className="topbar-context">
            {resolvedActive === "Dashboard" ? "Home" : resolvedActive}
          </span>
          <GlobalSearch />
          <div className="topbar-actions">
            <Link className="icon-button" href="/studio/notifications" aria-label="Notifications">
              <Bell size={19} />
            </Link>
            <Link href="/studio/copilot" className="copilot-button">
              <Sparkles size={16} />
              Ask Copilot
            </Link>
          </div>
        </header>
        {workspace.error ? (
          <div className="workspace-load-error" role="alert">
            <span>
              <strong>Studio data is temporarily unavailable</strong>
              <small>{workspace.error}</small>
            </span>
            <button onClick={workspace.retry} type="button">
              Retry
            </button>
          </div>
        ) : null}
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
