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
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", href: "/studio", icon: CircleGauge },
  { label: "Leads", href: "/studio/leads", icon: ContactRound, count: 7 },
  { label: "Projects", href: "/studio/projects", icon: FolderKanban },
  { label: "Calendar", href: "/studio/calendar", icon: CalendarDays },
  { label: "Clients", href: "/studio/clients", icon: UsersRound },
  { label: "Vendors", href: "/studio/vendors", icon: Handshake },
  { label: "Crew", href: "/studio/crew", icon: Aperture },
  { label: "Packages", href: "/studio/packages", icon: Package },
  { label: "Proposals", href: "/studio/proposals", icon: FileStack },
  { label: "Contracts", href: "/studio/contracts", icon: FileSignature },
  { label: "Invoices", href: "/studio/invoices", icon: ReceiptText },
  { label: "Booking", href: "/studio/booking", icon: BadgeCheck },
  { label: "Workflows", href: "/studio/workflows", icon: Workflow },
  { label: "Tasks", href: "/studio/tasks", icon: ListTodo },
  { label: "Readiness", href: "/studio/readiness", icon: ShieldCheck },
  { label: "Documents", href: "/studio/documents", icon: FileStack },
  { label: "Integrations", href: "/studio/integrations", icon: LayoutTemplate },
] as const;

export function AppShell({
  children,
  active = "Dashboard",
}: {
  children: React.ReactNode;
  active?: string;
}) {
  return (
    <div className="app-frame">
      <aside className="sidebar" id="studio-navigation">
        <div className="sidebar-brand">
          <Logo />
          <Link className="tenant-switcher" href="/studio/settings" aria-label="Open studio settings">
            <span className="avatar avatar-sand">AM</span>
            <span className="tenant-copy">
              <strong>Alder & Muse</strong>
              <small>Studio plan</small>
            </span>
            <ChevronDown size={15} />
          </Link>
        </div>

        <nav className="main-nav" aria-label="Studio navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                href={item.href}
                key={item.label}
                className={cn("nav-item", item.label === active && "nav-active")}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {"count" in item ? <span className="nav-count">{item.count}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <Link href="/studio/settings" className="nav-item">
            <Settings size={18} />
            <span>Settings</span>
          </Link>
          <div className="user-card">
            <span className="avatar avatar-ink">CL</span>
            <span className="tenant-copy">
              <strong>Conor Lawless</strong>
              <small>Studio owner</small>
            </span>
            <ChevronDown size={15} />
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <a className="mobile-menu" href="#studio-navigation" aria-label="Open navigation">
            <Menu size={20} />
          </a>
          <div className="command-search">
            <Search size={17} />
            <span>Search projects, clients, or tasks</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-actions">
            <Link className="icon-button" href="/studio/notifications" aria-label="Notifications">
              <Bell size={19} />
              <span className="notification-dot" />
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
