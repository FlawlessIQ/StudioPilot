import { CueMark } from "@/components/brand/logo";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ContactRound,
  FolderKanban,
  LayoutGrid,
  LibraryBig,
  ListTodo,
  Search,
  Settings2,
  Sparkles,
  BarChart3,
  UsersRound,
} from "lucide-react";

/**
 * Editorial studio shell for the redesign preview. Self-contained (no auth /
 * live data) so it can be viewed safely alongside the existing app.
 */
const NAV = [
  {
    label: "Workspace",
    items: [
      { label: "Home", icon: LayoutGrid, active: true },
      { label: "Pipeline", icon: ContactRound },
      { label: "Projects", icon: FolderKanban },
      { label: "Calendar", icon: CalendarDays },
      { label: "Tasks", icon: ListTodo },
      { label: "Clients", icon: UsersRound },
    ],
  },
  {
    label: "Studio",
    items: [
      { label: "Library", icon: LibraryBig },
      { label: "Reports", icon: BarChart3 },
      { label: "Studio setup", icon: Settings2 },
    ],
  },
] as const;

export function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-root" data-ds-theme="emerald">
      <div className="ds-shell">
        <aside className="ds-sidebar">
          <div className="ds-brand">
            <span className="ds-brand-mark ds-brand-mark-logo"><CueMark size={38} /></span>
            <span className="ds-brand-word">
              Studio<b>Cue</b>
            </span>
          </div>

          <button type="button" className="ds-switcher">
            <span className="ds-avatar">EL</span>
            <span className="ds-switcher-copy">
              <strong>Evergreen Lane Studio</strong>
              <small>Studio · Signature plan</small>
            </span>
            <ChevronDown size={15} />
          </button>

          <nav className="ds-nav" aria-label="Studio navigation">
            {NAV.map((section) => (
              <div className="ds-nav-section" key={section.label}>
                <span className="ds-nav-label">{section.label}</span>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <span
                      key={item.label}
                      className="ds-nav-item"
                      data-active={"active" in item && item.active ? "true" : "false"}
                    >
                      <Icon size={17} strokeWidth={1.8} />
                      <span>{item.label}</span>
                    </span>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="ds-sidebar-foot">
            <span className="ds-avatar ds-avatar-ink">JL</span>
            <span className="ds-switcher-copy">
              <strong>Jordan Lee</strong>
              <small>Studio owner</small>
            </span>
            <ChevronDown size={15} />
          </div>
        </aside>

        <div className="ds-main">
          <header className="ds-topbar">
            <span className="ds-crumb">
              <b>Workspace ·</b> Home
            </span>
            <span className="ds-search">
              <Search size={16} />
              Search projects, clients, or tasks
              <kbd>⌘K</kbd>
            </span>
            <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" aria-label="Notifications">
              <Bell size={17} />
            </button>
            <button type="button" className="ds-action">
              <Sparkles size={15} /> Ask Copilot
            </button>
          </header>

          <main className="ds-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
