"use client";

import Link from "next/link";
import {
  Aperture,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleGauge,
  ContactRound,
  FileStack,
  FileSignature,
  FolderKanban,
  Handshake,
  LayoutTemplate,
  Menu,
  Package,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  ListTodo,
  UsersRound,
  Workflow,
  BadgeCheck,
  ClipboardList,
  GanttChartSquare,
  Images,
  Star,
  ChartNoAxesColumn,
  WandSparkles,
  CreditCard,
  MessageCircle,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
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
      { label: "Dashboard", href: "/studio", icon: CircleGauge },
      { label: "Projects", href: "/studio/projects", icon: FolderKanban },
      { label: "Calendar", href: "/studio/calendar", icon: CalendarDays },
      { label: "Tasks", href: "/studio/tasks", icon: ListTodo },
    ],
  },
  {
    label: "Client lifecycle",
    items: [
      { label: "Leads", href: "/studio/leads", icon: ContactRound },
      { label: "Clients", href: "/studio/clients", icon: UsersRound },
      { label: "Packages", href: "/studio/packages", icon: Package },
      { label: "Proposals", href: "/studio/proposals", icon: FileStack },
      { label: "Contracts", href: "/studio/contracts", icon: FileSignature },
      { label: "Invoices", href: "/studio/invoices", icon: ReceiptText },
      { label: "Booking", href: "/studio/booking", icon: BadgeCheck },
      {
        label: "Questionnaires",
        href: "/studio/questionnaires",
        icon: ClipboardList,
      },
    ],
  },
  {
    label: "Production",
    items: [
      { label: "Vendors", href: "/studio/vendors", icon: Handshake },
      { label: "Crew", href: "/studio/crew", icon: Aperture },
      { label: "Insurance", href: "/studio/insurance", icon: ShieldCheck },
      { label: "Schedules", href: "/studio/schedules", icon: GanttChartSquare },
      { label: "Readiness", href: "/studio/readiness", icon: ShieldCheck },
      {
        label: "Post-production",
        href: "/studio/post-production",
        icon: WandSparkles,
      },
      { label: "Delivery", href: "/studio/delivery", icon: Images },
      { label: "Reviews", href: "/studio/reviews", icon: Star },
    ],
  },
  {
    label: "Studio",
    items: [
      { label: "Workflows", href: "/studio/workflows", icon: Workflow },
      { label: "Documents", href: "/studio/documents", icon: FileStack },
      {
        label: "Communications",
        href: "/studio/messages",
        icon: MessageCircle,
      },
      { label: "Reports", href: "/studio/reports", icon: ChartNoAxesColumn },
      {
        label: "Integrations",
        href: "/studio/integrations",
        icon: LayoutTemplate,
      },
      { label: "Team", href: "/studio/team", icon: UsersRound },
      {
        label: "Subscription",
        href: "/studio/subscription",
        icon: CreditCard,
      },
    ],
  },
] as const;

export function AppShell({
  children,
  active = "Dashboard",
}: {
  children: React.ReactNode;
  active?: string;
}) {
  return <AuthBoundary area="studio">
    <WorkspaceProvider area="studio">
      <StudioShell active={active}>{children}</StudioShell>
    </WorkspaceProvider>
  </AuthBoundary>;
}

function StudioShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active: string;
}) {
  const workspace = useWorkspace();
  const tenantName = workspace.error ? "Workspace unavailable" : workspace.tenantName;
  const userName = workspace.error ? "Signed-in user" : workspace.userName;
  const staffAllowed = new Set([
    "Dashboard",
    "Projects",
    "Calendar",
    "Tasks",
    "Documents",
    "Communications",
    "Schedules",
    "Readiness",
  ]);
  const coordinatorExcluded = new Set([
    "Packages",
    "Workflows",
    "Reports",
    "Integrations",
    "Team",
    "Subscription",
  ]);
  const canSee = (label: string) => {
    if (workspace.role === "staff_photographer")
      return staffAllowed.has(label);
    if (workspace.role === "studio_coordinator")
      return !coordinatorExcluded.has(label);
    if (workspace.role === "studio_admin")
      return !["Team", "Subscription"].includes(label);
    return true;
  };
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canSee(item.label)),
    }))
    .filter((section) => section.items.length);
  return (
    <div className="app-frame">
      <aside className="sidebar" id="studio-navigation">
        <div className="sidebar-brand">
          <Logo />
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
                    className={cn(
                      "nav-item",
                      item.label === active && "nav-active",
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
          <PlatformReturnLink />
          {workspace.role === "studio_owner" ? (
            <Link href="/studio/settings" className="nav-item">
              <Settings size={18} />
              <span>Settings</span>
            </Link>
          ) : null}
          <div className="user-card">
            <span className="avatar avatar-ink">{initials(userName)}</span>
            <span className="tenant-copy">
              <strong>{userName}</strong>
              <small>{workspaceRoleLabel(workspace.role)}</small>
            </span>
            <SignOutButton className="shell-signout" />
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <a className="mobile-menu" href="#studio-navigation" aria-label="Open navigation">
            <Menu size={20} />
          </a>
          <span className="topbar-context">{active}</span>
          <div className="command-search">
            <Search size={17} />
            <span>Search projects, clients, or tasks</span>
            <kbd>⌘ K</kbd>
          </div>
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
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
