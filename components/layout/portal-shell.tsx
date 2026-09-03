"use client";

import { CueMark } from "@/components/brand/logo";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarCheck,
  CalendarDays,
  CircleAlert,
  CircleDollarSign,
  ClipboardList,
  FileSignature,
  FolderOpen,
  Home,
  Images,
  ListChecks,
  LockKeyhole,
  Menu,
  MessageCircle,
  Package,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { AuthBoundary, SignOutButton } from "@/features/auth/auth-boundary";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/features/auth/workspace-context";
import { clientAreaItems } from "@/features/client/portal-navigation";

const PortalShellContext = createContext(false);

const clientRouteLabels: Record<string, string> = {
  contract: "Contract",
  delivery: "Delivery",
  documents: "Files",
  messages: "Messages",
  package: "Package",
  payments: "Payments",
  project: "Project details",
  proposal: "Proposal",
  questionnaire: "Questionnaires",
  reviews: "Reviews",
  schedule: "Schedule",
};

function monogram(value?: string) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "··";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function PortalShell({
  children,
  active,
  projectName,
  projectDate,
}: {
  children: React.ReactNode;
  active?: string;
  projectName?: string;
  projectDate?: string;
}) {
  const shellMounted = useContext(PortalShellContext);
  if (shellMounted) return <>{children}</>;
  return (
    <PortalShellContext.Provider value>
      <WorkspaceProvider area="client">
        <AuthBoundary area="client">
          <ClientPortalShell
            active={active}
            projectName={projectName}
            projectDate={projectDate}
          >
            {children}
          </ClientPortalShell>
        </AuthBoundary>
      </WorkspaceProvider>
    </PortalShellContext.Provider>
  );
}

function ClientPortalShell({
  children,
  active,
  projectName,
  projectDate,
}: {
  children: React.ReactNode;
  active?: string;
  projectName?: string;
  projectDate?: string;
}) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const workspace = useWorkspace();
  const router = useRouter();
  const routeSegment = pathname.split("/").filter(Boolean)[1] ?? "";
  const resolvedActive = active ?? clientRouteLabels[routeSegment] ?? "Home";
  const displayedProjectName = projectName ?? workspace.projectName;
  const displayedProjectDate = projectDate ?? workspace.projectDate;
  const formattedProjectDate = /^\d{4}-\d{2}-\d{2}$/.test(displayedProjectDate)
    ? new Date(`${displayedProjectDate}T12:00:00`).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : displayedProjectDate;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const update = () => setMobileNavigation(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobileNavigation) return;
    document.body.style.overflow = navigationOpen ? "hidden" : "";
    if (navigationOpen) closeButton.current?.focus();
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavigation, navigationOpen]);

  function closeNavigation() {
    setNavigationOpen(false);
    if (mobileNavigation) {
      window.requestAnimationFrame(() => menuButton.current?.focus());
    }
  }

  async function switchProject(projectId: string) {
    await workspace.selectProject(projectId);
    closeNavigation();
    router.push("/client");
  }

  const multipleProjects = workspace.clientProjects.length > 1;
  const nextAction = workspace.clientProject?.nextClientAction;
  /**
   * The areas this couple can actually open, as the server already decided.
   *
   * The nav was four hardcoded entries plus one slot derived from the next
   * action, and nine routes competed for that slot — so a run of show holding
   * "Approve this version" was reachable only by typing the URL. The server
   * had been returning a per-area `ClientNavigation` the whole time
   * (`schedule: true` at that stage) and no component read it. The comment
   * that used to sit beside "Payments" records the class being hit once
   * before and fixed by hardcoding one more link.
   *
   * Overview, records, payments and messages stay fixed. The rest appear when
   * the server says the area exists for this project.
   */
  const navigation = workspace.clientProject?.navigation;
  // Which icon each area shows. The list itself is pure and tested — see
  // features/client/portal-navigation.ts.
  const AREA_ICONS = {
    CalendarCheck,
    Package,
    ClipboardList,
    FileSignature,
    ListChecks,
    CalendarDays,
    Images,
    Star,
  } as const;
  const areaItems = clientAreaItems(navigation).map((item) => ({
    label: item.label,
    href: item.href,
    icon: AREA_ICONS[item.icon],
  }));
  const navItems = [
    { label: "Overview", icon: Home, href: "/client" },
    ...(nextAction && !["/client", "/client/messages"].includes(nextAction.href)
      ? [
          {
            label:
              nextAction.responsibility === "client"
                ? "Your next step"
                : "Project status",
            icon: ClipboardList,
            href: nextAction.href,
          },
        ]
      : []),
    // The next step already links its own page; do not list it twice.
    ...areaItems.filter((item) => item.href !== nextAction?.href),
    { label: "Project records", icon: FolderOpen, href: "/client/documents" },
    { label: "Payments", icon: CircleDollarSign, href: "/client/payments" },
    { label: "Messages", icon: MessageCircle, href: "/client/messages" },
  ];
  const contextualRoutes = new Set([
    "/client/project",
    "/client/proposal",
    "/client/package",
    "/client/contract",
    "/client/payments",
    "/client/questionnaire",
    "/client/schedule",
    "/client/delivery",
    "/client/reviews",
  ]);

  if (workspace.loading) return <ClientPortalLoadingShell />;

  return (
    <div className="ds-root" data-ds-theme="emerald">
      <div className={navigationOpen ? "ds-shell ds-nav-open" : "ds-shell"}>
        <button
          aria-label="Close navigation"
          className="ds-nav-backdrop"
          onClick={closeNavigation}
          type="button"
        />
        <aside
          aria-hidden={mobileNavigation && !navigationOpen}
          className="ds-sidebar"
          id="portal-navigation"
          inert={mobileNavigation && !navigationOpen ? true : undefined}
        >
          <div className="ds-brand-row">
            <Link className="ds-brand" href="/client" onClick={closeNavigation}>
              <span className="ds-brand-mark ds-brand-mark-logo"><CueMark size={38} /></span>
              <span className="ds-brand-word">
                Studio<b>Cue</b>
              </span>
            </Link>
            <button
              aria-label="Close navigation"
              className="ds-sidebar-close"
              onClick={closeNavigation}
              ref={closeButton}
              type="button"
            >
              <X size={19} />
            </button>
          </div>

          {multipleProjects ? (
            <div className="ds-nav-section">
              <span className="ds-nav-label">Current project</span>
              <label>
                <span className="sr-only">Choose a project</span>
                <select
                  aria-label="Choose a client project"
                  onChange={(event) => void switchProject(event.target.value)}
                  value={workspace.projectId ?? ""}
                  style={{ width: "100%" }}
                >
                  {workspace.clientProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="ds-switcher" style={{ cursor: "default" }}>
              <span className="ds-avatar">{monogram(displayedProjectName)}</span>
              <span className="ds-switcher-copy">
                <strong>{displayedProjectName || "Your project"}</strong>
                <small>{formattedProjectDate || "Date pending"}</small>
              </span>
            </div>
          )}

          <nav className="ds-nav" aria-label="Client portal navigation">
            <div className="ds-nav-section">
              <span className="ds-nav-label">Your project</span>
              {navItems.map((item) => {
                const Icon = item.icon;
                const activeItem =
                  pathname === item.href ||
                  (item.label === "Project records" &&
                    contextualRoutes.has(pathname) &&
                    nextAction?.href !== pathname);
                return (
                  <Link
                    href={item.href}
                    className="ds-nav-item"
                    data-active={activeItem ? "true" : "false"}
                    key={`${item.label}-${item.href}`}
                    onClick={closeNavigation}
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="ds-sidebar-foot">
            <span className="ds-avatar ds-avatar-ink">
              <UserRound size={16} />
            </span>
            <span className="ds-switcher-copy">
              <strong>{workspace.error ? "Client portal" : workspace.userName}</strong>
              <small>Client</small>
            </span>
            <LockKeyhole aria-label="Secure client access" size={15} />
          </div>
        </aside>

        <div className="ds-main">
          <header className="ds-topbar">
            <button
              aria-controls="portal-navigation"
              aria-expanded={navigationOpen}
              aria-label="Open client navigation"
              className="ds-mobile-menu"
              onClick={() => setNavigationOpen(true)}
              ref={menuButton}
              type="button"
            >
              <Menu size={20} />
            </button>
            <span className="ds-crumb">
              <b>Portal ·</b> {resolvedActive}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--ds-muted)" }}>
              {workspace.tenantName}
            </span>
            <SignOutButton className="ds-btn ds-btn-ghost ds-btn-sm" />
          </header>
          {workspace.error ? (
            <div className="ds-topbar-error" role="alert">
              <span className="ds-alert-ico">
                <CircleAlert size={18} />
              </span>
              <div className="ds-alert-copy">
                <strong>Your project workspace is temporarily unavailable</strong>
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

function ClientPortalLoadingShell() {
  return (
    <div className="ds-root client-portal-loading" data-ds-theme="emerald" aria-live="polite">
      <div className="ds-shell">
        <aside className="ds-sidebar" aria-label="Opening client portal">
          <div className="ds-brand-row">
            <span className="ds-brand">
              <span className="ds-brand-mark">S</span>
              <span className="ds-brand-word">Studio<b>Cue</b></span>
            </span>
          </div>
          <div className="client-portal-skeleton-project">
            <span className="client-portal-skeleton-avatar" />
            <span><i /><i /></span>
          </div>
          <div className="client-portal-skeleton-nav">
            <i /><i /><i />
          </div>
        </aside>
        <div className="ds-main">
          <header className="ds-topbar">
            <span className="ds-crumb"><b>Portal</b></span>
          </header>
          <main className="ds-content client-portal-skeleton-content">
            <span className="auth-loading-spinner" aria-hidden="true" />
            <strong>Opening your secure project</strong>
            <small>Loading your approved project details…</small>
          </main>
        </div>
      </div>
    </div>
  );
}
