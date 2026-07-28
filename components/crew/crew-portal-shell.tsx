"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, ClipboardCheck, FileText, Home, Menu, UserRound, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AuthBoundary,SignOutButton } from "@/features/auth/auth-boundary";
import {
  initials,
  useWorkspace,
  WorkspaceProvider,
} from "@/features/auth/workspace-context";

const navSections = [
  {
    label: "Assignments",
    items: [
      { label: "Home", href: "/crew", icon: Home },
      { label: "Pending jobs", href: "/crew/pending", icon: ClipboardCheck },
      { label: "Accepted jobs", href: "/crew/accepted", icon: CalendarDays },
      { label: "Schedule", href: "/crew/schedule", icon: CalendarDays },
      { label: "Requirements", href: "/crew/requirements", icon: ClipboardCheck },
      { label: "Documents", href: "/crew/documents", icon: FileText },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/crew/profile", icon: UserRound },
      { label: "Availability", href: "/crew/availability", icon: CalendarDays },
    ],
  },
] as const;

export function CrewPortalShell({ children, active = "Home" }: { children: React.ReactNode; active?: string }) {
  return <AuthBoundary area="crew"><WorkspaceProvider area="crew"><CrewShell active={active}>{children}</CrewShell></WorkspaceProvider></AuthBoundary>;
}

function CrewShell({ children, active }: { children: React.ReactNode; active: string }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const workspace = useWorkspace();
  return <div className={navigationOpen ? "crew-portal-frame crew-navigation-open" : "crew-portal-frame"}>
    <button aria-label="Close navigation" className="crew-navigation-backdrop" onClick={() => setNavigationOpen(false)} type="button" />
    <aside className={navigationOpen ? "crew-portal-sidebar crew-portal-sidebar-open" : "crew-portal-sidebar"} id="crew-navigation">
      <div className="crew-sidebar-brand">
        <Link href="/crew" onClick={() => setNavigationOpen(false)}><Logo /></Link>
        <button aria-label="Close navigation" className="crew-sidebar-close" onClick={() => setNavigationOpen(false)} type="button"><X size={19}/></button>
      </div>
      <div className="crew-identity"><span className="avatar avatar-sand">{initials(workspace.userName)}</span><span><strong>{workspace.userName}</strong><small>Subcontractor</small></span></div>
      <nav aria-label="Crew portal navigation">{navSections.map(section => <div className="crew-nav-section" key={section.label}><span className="crew-nav-label">{section.label}</span>{section.items.map(item => { const Icon=item.icon; return <Link href={item.href} className={item.label===active?"crew-nav-active":""} key={item.label} onClick={() => setNavigationOpen(false)}><Icon size={17}/><span>{item.label}</span></Link> })}</div>)}</nav>
      <div className="crew-privacy"><strong>Your assignments stay private</strong><small>You will only see the jobs, contacts, files, and schedule details shared with you.</small></div>
    </aside>
    <main className="crew-portal-content"><header><button aria-controls="crew-navigation" aria-expanded={navigationOpen} className="mobile-menu" onClick={() => setNavigationOpen(true)} type="button" aria-label="Open crew navigation"><Menu size={20}/></button><span className="crew-page-context">{active}</span><span className="crew-studio-name">{workspace.tenantName}</span><SignOutButton/></header>{children}</main>
  </div>;
}
