"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  Home,
  Images,
  LockKeyhole,
  Menu,
  MessageCircle,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { AuthBoundary, SignOutButton } from "@/features/auth/auth-boundary";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/features/auth/workspace-context";

const portalNavSections = [
  {
    label: "Your workspace",
    items: [
      { label: "Home", icon: Home, href: "/client" },
      { label: "Project details", icon: CalendarDays, href: "/client/project" },
      {
        label: "Schedule",
        icon: CalendarDays,
        href: "/client/schedule",
        capability: "schedule",
      },
      {
        label: "Files",
        icon: FolderOpen,
        href: "/client/documents",
        capability: "files",
      },
      { label: "Messages", icon: MessageCircle, href: "/client/messages" },
    ],
  },
  {
    label: "Booking & planning",
    items: [
      {
        label: "Proposal",
        icon: FileText,
        href: "/client/proposal",
        capability: "proposal",
      },
      {
        label: "Package",
        icon: FileText,
        href: "/client/package",
        capability: "package",
      },
      {
        label: "Contract",
        icon: FileText,
        href: "/client/contract",
        capability: "contract",
      },
      {
        label: "Payments",
        icon: CreditCard,
        href: "/client/payments",
        capability: "payments",
      },
      {
        label: "Questionnaires",
        icon: ClipboardList,
        href: "/client/questionnaire",
        capability: "questionnaire",
      },
    ],
  },
  {
    label: "After delivery",
    items: [
      {
        label: "Delivery",
        icon: Images,
        href: "/client/delivery",
        capability: "delivery",
      },
      {
        label: "Reviews",
        icon: Star,
        href: "/client/reviews",
        capability: "reviews",
      },
    ],
  },
] as const;

function monogram(value?: string) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "··";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function PortalShell({
  children,
  active = "Home",
  projectName,
  projectDate,
}: {
  children: React.ReactNode;
  active?: string;
  projectName?: string;
  projectDate?: string;
}) {
  return (
    <AuthBoundary area="client">
      <WorkspaceProvider area="client">
        <ClientPortalShell
          active={active}
          projectName={projectName}
          projectDate={projectDate}
        >
          {children}
        </ClientPortalShell>
      </WorkspaceProvider>
    </AuthBoundary>
  );
}

function ClientPortalShell({
  children,
  active,
  projectName,
  projectDate,
}: {
  children: React.ReactNode;
  active: string;
  projectName?: string;
  projectDate?: string;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const workspace = useWorkspace();
  const router = useRouter();
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
              <span className="ds-brand-mark">S</span>
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
            {portalNavSections.map((section) => {
              const visibleItems = section.items.filter(
                (item) =>
                  !("capability" in item) ||
                  workspace.clientProject?.navigation[item.capability] === true,
              );
              if (!visibleItems.length) return null;
              return (
                <div className="ds-nav-section" key={section.label}>
                  <span className="ds-nav-label">{section.label}</span>
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        href={item.href}
                        className="ds-nav-item"
                        data-active={item.label === active ? "true" : "false"}
                        key={item.label}
                        onClick={closeNavigation}
                      >
                        <Icon size={17} strokeWidth={1.8} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <div className="ds-sidebar-foot">
            <span className="ds-avatar ds-avatar-ink">
              <UserRound size={16} />
            </span>
            <span className="ds-switcher-copy">
              <strong>{workspace.userName}</strong>
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
              <b>Portal ·</b> {active}
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
