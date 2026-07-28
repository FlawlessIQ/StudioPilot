"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
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
import { Logo } from "@/components/brand/logo";
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
    ? new Date(`${displayedProjectDate}T12:00:00`).toLocaleDateString(
        undefined,
        { month: "long", day: "numeric", year: "numeric" },
      )
    : displayedProjectDate;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
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

  return (
    <div
      className={
        navigationOpen
          ? "portal-frame portal-navigation-open"
          : "portal-frame"
      }
    >
      <button
        aria-label="Close navigation"
        className="portal-navigation-backdrop"
        onClick={closeNavigation}
        type="button"
      />
      <aside
        aria-hidden={mobileNavigation && !navigationOpen}
        className={
          navigationOpen
            ? "portal-sidebar portal-sidebar-open"
            : "portal-sidebar"
        }
        id="portal-navigation"
        inert={mobileNavigation && !navigationOpen ? true : undefined}
      >
        <div className="portal-sidebar-brand">
          <Link href="/client" onClick={closeNavigation}>
            <Logo />
          </Link>
          <button
            aria-label="Close navigation"
            className="portal-sidebar-close"
            onClick={closeNavigation}
            ref={closeButton}
            type="button"
          >
            <X size={19} />
          </button>
        </div>
        <div
          className={
            workspace.clientProjects.length > 1
              ? "portal-project portal-project-switcher"
              : "portal-project"
          }
        >
          <small>
            {workspace.clientProjects.length > 1
              ? "Current project"
              : "Your project"}
          </small>
          {workspace.clientProjects.length > 1 ? (
            <label>
              <span className="sr-only">Choose a project</span>
              <select
                aria-label="Choose a client project"
                onChange={(event) => void switchProject(event.target.value)}
                value={workspace.projectId ?? ""}
              >
                {workspace.clientProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" size={15} />
            </label>
          ) : (
            <strong>{displayedProjectName}</strong>
          )}
          <span>{formattedProjectDate || "Date pending"}</span>
        </div>
        <nav aria-label="Client portal navigation">
          {portalNavSections.map((section) => {
            const visibleItems = section.items.filter(
              (item) =>
                !("capability" in item) ||
                workspace.clientProject?.navigation[item.capability] === true,
            );
            if (!visibleItems.length) return null;
            return (
              <div className="portal-nav-section" key={section.label}>
                <span className="portal-nav-label">{section.label}</span>
                {visibleItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    href={item.href}
                    className={
                      item.label === active ? "portal-nav-active" : ""
                    }
                    key={item.label}
                    onClick={closeNavigation}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
                  </Link>
                );
                })}
              </div>
            );
          })}
        </nav>
        <div className="portal-profile">
          <span className="avatar avatar-sand">
            <UserRound size={16} />
          </span>
          <span>
            <strong>{workspace.userName}</strong>
            <small>Client</small>
          </span>
          <LockKeyhole aria-label="Secure client access" size={15} />
        </div>
      </aside>
      <main className="portal-content">
        <header>
          <button
            aria-controls="portal-navigation"
            aria-expanded={navigationOpen}
            aria-label="Open client navigation"
            className="mobile-menu"
            onClick={() => setNavigationOpen(true)}
            ref={menuButton}
            type="button"
          >
            <Menu size={20} />
          </button>
          <span className="portal-page-context">{active}</span>
          <span className="portal-studio-name">{workspace.tenantName}</span>
          <SignOutButton />
        </header>
        {children}
      </main>
    </div>
  );
}
