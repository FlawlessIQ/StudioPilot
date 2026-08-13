"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  BrainCircuit,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  CircleGauge,
  ContactRound,
  FolderKanban,
  Images,
  Radio,
  LibraryBig,
  Menu,
  MessageSquareText,
  Settings,
  Sparkles,
  ChartNoAxesColumn,
  UsersRound,
  WandSparkles,
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
    label: "Your work",
    items: [
      { label: "Home", href: "/studio", icon: CircleGauge },
      { label: "Inbox", href: "/studio/leads", icon: ContactRound },
      { label: "Projects", href: "/studio/projects", icon: FolderKanban },
      { label: "Messages", href: "/studio/messages", icon: MessageSquareText },
      { label: "Ask StudioCue", href: "/studio/copilot", icon: WandSparkles },
      { label: "AI review", href: "/studio/ai-queue", icon: BrainCircuit },
      { label: "Calendar", href: "/studio/calendar", icon: CalendarDays },
      { label: "Event day", href: "/studio/event-day", icon: Radio },
      { label: "Deliveries", href: "/studio/delivery", icon: Images },
    ],
  },
  {
    label: "Your studio",
    items: [
      { label: "People", href: "/studio/clients", icon: UsersRound },
      {
        label: "Library",
        href: "/studio/library",
        icon: LibraryBig,
      },
      {
        label: "Insights",
        href: "/studio/reports",
        icon: ChartNoAxesColumn,
      },
      {
        label: "Studio setup",
        href: "/studio/setup",
        icon: Settings,
      },
    ],
  },
] as const;

const activeGroups: Record<string, string[]> = {
  Home: ["Dashboard", "Notifications", "AI setup"],
  Messages: ["Communications"],
  "Ask StudioCue": ["Copilot"],
  "AI review": ["AI queue"],
  Inbox: ["Leads", "Inquiries", "Proposals", "Contracts", "Invoices", "Booking"],
  Projects: [
    "Projects",
    "Questionnaires",
    "Insurance",
    "Schedules",
    "Readiness",
    "Documents",
  ],
  Calendar: ["Calendar"],
  "Event day": ["Event day"],
  Deliveries: ["Post-production", "Delivery", "Reviews"],
  People: ["Clients", "Crew", "Team", "Vendors"],
  Library: ["Library", "Packages", "Workflows", "Tasks", "Documents"],
  Insights: ["Reports"],
  "Studio setup": ["Studio setup", "Settings", "Integrations", "Subscription"],
};

const StudioShellContext = createContext(false);

const studioRouteLabels: Record<string, string> = {
  audit: "Workflows",
  "ai-queue": "AI queue",
  automations: "Workflows",
  booking: "Booking",
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
    "Ask StudioCue",
    "Calendar",
    "Event day",
    "Deliveries",
    "People",
  ]);
  const coordinatorExcluded = new Set(["Insights", "Library"]);
  const canSee = (label: string) => {
    if (label === "Studio setup") return workspace.role === "studio_owner";
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

          {workspace.role !== "staff_photographer" ? (
            <Link
              className="ds-side-ai"
              href="/studio/import"
              onClick={() => setNavigationOpen(false)}
            >
              <span className="ds-side-ai-icon">
                <WandSparkles size={17} />
              </span>
              <span className="ds-side-ai-copy">
                <small>AI studio</small>
                <strong>Import your workflow</strong>
                <em>Turn existing files into templates</em>
              </span>
            </Link>
          ) : null}

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
              <Link href="/auth/workspaces">Switch workspace</Link>
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
              <b>Workspace ·</b> {resolvedActive === "Dashboard" ? "Home" : resolvedActive}
            </span>
            <GlobalSearch />
            <Link className="ds-btn ds-btn-ghost ds-btn-sm" href="/studio/delivery">
              <Images size={16} /> Deliveries
            </Link>
            <Link
              className="ds-btn ds-btn-ghost ds-btn-sm"
              href="/studio/notifications"
              aria-label="Notifications"
            >
              <Bell size={18} />
            </Link>
            <Link href="/studio/import" className="ds-action">
              <Sparkles size={15} /> Create with AI
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
