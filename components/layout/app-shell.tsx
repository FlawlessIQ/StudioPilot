"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  CircleGauge,
  FolderKanban,
  LibraryBig,
  Menu,
  MessageSquareText,
  Settings,
  Sparkles,
  ChartNoAxesColumn,
  UsersRound,
  X,
} from "lucide-react";
import { CueMark } from "@/components/brand/logo";
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
      { label: "Projects", href: "/studio/projects", icon: FolderKanban },
      { label: "Calendar", href: "/studio/calendar", icon: CalendarDays },
      { label: "Messages", href: "/studio/messages", icon: MessageSquareText },
      { label: "People", href: "/studio/clients", icon: UsersRound },
    ],
  },
  {
    // Cross-project workspaces. Both existed in the product's own nav plan and
    // were lost in the simplification pass: the AI review queue was reachable
    // only via a "Review all" link that read like "more inquiries", and
    // Insights sat inside the account popover next to Sign out.
    label: "Studio",
    items: [
      { label: "AI review", href: "/studio/ai-queue", icon: Sparkles },
      { label: "Insights", href: "/studio/reports", icon: ChartNoAxesColumn },
    ],
  },
] as const;

const activeGroups: Record<string, string[]> = {
  Home: ["Dashboard", "Notifications", "Leads", "Inquiries"],
  "AI review": ["AI review", "Copilot"],
  Insights: ["Insights"],
  Messages: ["Messages"],
  Projects: [
    "Projects",
    "Proposals",
    "Contracts",
    "Invoices",
    "Client & booking",
    "Planning",
    "Questionnaires",
    "Insurance",
    "Schedules",
    "Readiness",
    "Documents",
    "Event day",
    "Post-production",
    "Delivery",
    "Reviews",
  ],
  Calendar: ["Calendar"],
  People: ["Clients", "Crew", "Team", "Vendors"],
};

const StudioShellContext = createContext(false);

const studioRouteLabels: Record<string, string> = {
  audit: "Workflows",
  "ai-queue": "AI review",
  automations: "Workflows",
  booking: "Client & booking",
  calendar: "Calendar",
  clients: "Clients",
  contracts: "Contracts",
  copilot: "Copilot",
  crew: "Crew",
  delivery: "Delivery",
  "event-day": "Event day",
  documents: "Documents",
  insurance: "Insurance",
  integrations: "Integrations",
  import: "AI setup",
  invoices: "Invoices",
  leads: "Inquiries",
  library: "Library",
  messages: "Messages",
  notifications: "Notifications",
  packages: "Packages",
  planning: "Planning",
  "post-production": "Post-production",
  projects: "Projects",
  proposals: "Proposals",
  questionnaires: "Questionnaires",
  readiness: "Readiness",
  reports: "Insights",
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
    "Messages",
    "People",
  ]);
  const canSee = (label: string) => {
    if (workspace.role === "staff_photographer") return staffAllowed.has(label);
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
    )?.[0] ?? "Home";

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
              <span className="ds-brand-mark ds-brand-mark-logo">
                <CueMark size={38} />
              </span>
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
            <summary className="ds-sidebar-foot" aria-label="Workspace and account menu">
              <span className="ds-avatar">{initials(tenantName)}</span>
              <span className="ds-switcher-copy">
                <strong>{tenantName}</strong>
                <small>{workspace.tenantPlan || "Studio workspace"}</small>
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className="ds-user-pop">
              <div className="ds-user-pop-identity">
                <span className="ds-avatar ds-avatar-ink">{initials(userName)}</span>
                <span className="ds-switcher-copy">
                  <strong>{userName}</strong>
                  <small>{workspaceRoleLabel(workspace.role)}</small>
                </span>
              </div>
              <span className="ds-user-pop-label">Studio</span>
              {/* Insights moved to the sidebar — analytics do not belong in a
                  menu next to Sign out. Library stays here until it earns a
                  nav item of its own. */}
              {workspace.role !== "staff_photographer" ? (
                <Link href="/studio/library"><LibraryBig size={15} /> Library</Link>
              ) : null}
              {workspace.role === "studio_owner" ? (
                <Link href="/studio/setup"><Settings size={15} /> Studio settings</Link>
              ) : null}
              <Link href="/auth/workspaces">Switch workspace</Link>
              <PlatformReturnLink />
              <SignOutButton className="ds-user-signout" />
            </div>
          </details>
        </aside>

        {/* Primary destinations within thumb reach. On a tool used on a phone
            during an event, burying navigation behind a hamburger costs a tap
            every time. */}
        <nav aria-label="Primary" className="ds-tabbar">
          {visibleSections[0]?.items.slice(0, 5).map((item) => {
            const Icon = item.icon;
            return (
              <Link
                data-active={item.label === currentGroup ? "true" : "false"}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" size={19} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
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
              <b>Workspace ·</b> {resolvedActive === "Dashboard" ? "Home" : resolvedActive}
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
              <Sparkles size={15} /> Ask or create
            </Link>
          </header>
          {workspace.error ? (
            <div className="ds-topbar-error" role="alert">
              <span className="ds-alert-ico">
                <CircleAlert size={18} />
              </span>
              <div className="ds-alert-copy">
                <strong>Studio data is temporarily unavailable</strong>
                <small>{workspace.error}</small>
              </div>
              <button
                className="ds-btn ds-btn-ghost ds-btn-sm"
                onClick={workspace.retry}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}
          <main className="ds-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
