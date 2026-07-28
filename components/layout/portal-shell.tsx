"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  Home,
  Images,
  Menu,
  MessageCircle,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AuthBoundary,SignOutButton } from "@/features/auth/auth-boundary";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/features/auth/workspace-context";

const portalNavSections = [
  {
    label: "Project",
    items: [
      { label: "Home", icon: Home, href: "/client" },
      { label: "Project details", icon: CalendarDays, href: "/client/project" },
      { label: "Package", icon: FileText, href: "/client/package" },
      { label: "Contract", icon: FileText, href: "/client/contract" },
      { label: "Payments", icon: CreditCard, href: "/client/payments" },
    ],
  },
  {
    label: "Planning",
    items: [
      { label: "Questionnaires", icon: ClipboardList, href: "/client/questionnaire" },
      { label: "Schedule", icon: CalendarDays, href: "/client/schedule" },
      { label: "Documents", icon: FolderOpen, href: "/client/documents" },
      { label: "Messages", icon: MessageCircle, href: "/client/messages" },
    ],
  },
  {
    label: "After delivery",
    items: [
      { label: "Delivery", icon: Images, href: "/client/delivery" },
      { label: "Reviews", icon: Star, href: "/client/reviews" },
    ],
  },
] as const;

export function PortalShell({ children, active = "Home", projectName, projectDate }: { children: React.ReactNode; active?: string; projectName?: string; projectDate?: string }) {
  return <AuthBoundary area="client">
    <WorkspaceProvider area="client">
      <ClientPortalShell active={active} projectName={projectName} projectDate={projectDate}>
        {children}
      </ClientPortalShell>
    </WorkspaceProvider>
  </AuthBoundary>;
}

function ClientPortalShell({ children, active, projectName, projectDate }: { children: React.ReactNode; active: string; projectName?: string; projectDate?: string }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const workspace = useWorkspace();
  const displayedProjectName = projectName ?? workspace.projectName;
  const displayedProjectDate = projectDate ?? workspace.projectDate;
  return (
    <div className={navigationOpen ? "portal-frame portal-navigation-open" : "portal-frame"}>
      <button
        aria-label="Close navigation"
        className="portal-navigation-backdrop"
        onClick={() => setNavigationOpen(false)}
        type="button"
      />
      <aside className={navigationOpen ? "portal-sidebar portal-sidebar-open" : "portal-sidebar"} id="portal-navigation">
        <div className="portal-sidebar-brand">
          <Link href="/client" onClick={() => setNavigationOpen(false)}><Logo /></Link>
          <button aria-label="Close navigation" className="portal-sidebar-close" onClick={() => setNavigationOpen(false)} type="button">
            <X size={19} />
          </button>
        </div>
        <div className="portal-project">
          <small>Your project</small>
          <strong>{displayedProjectName}</strong>
          <span>{displayedProjectDate || "Date pending"}</span>
        </div>
        <nav aria-label="Client portal navigation">
          {portalNavSections.map((section) => (
            <div className="portal-nav-section" key={section.label}>
              <span className="portal-nav-label">{section.label}</span>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    href={item.href}
                    className={item.label === active ? "portal-nav-active" : ""}
                    key={item.label}
                    onClick={() => setNavigationOpen(false)}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="portal-profile">
          <span className="avatar avatar-sand"><UserRound size={16} /></span>
          <span><strong>{workspace.userName}</strong><small>Client</small></span>
          <ChevronRight size={15} />
        </div>
      </aside>
      <main className="portal-content">
        <header>
          <button
            aria-controls="portal-navigation"
            aria-expanded={navigationOpen}
            className="mobile-menu"
            onClick={() => setNavigationOpen(true)}
            type="button"
            aria-label="Open client navigation"
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
