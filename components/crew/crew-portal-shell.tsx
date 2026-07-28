"use client";

import Link from "next/link";
import { CalendarDays, ClipboardCheck, FileText, Home, Menu, UserRound } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AuthBoundary,SignOutButton } from "@/features/auth/auth-boundary";
import {
  initials,
  useWorkspace,
  WorkspaceProvider,
} from "@/features/auth/workspace-context";

const nav = [
  { label: "Home", href: "/crew", icon: Home },
  { label: "Pending jobs", href: "/crew/pending", icon: ClipboardCheck },
  { label: "Accepted jobs", href: "/crew/accepted", icon: CalendarDays },
  { label: "Schedule", href: "/crew/schedule", icon: CalendarDays },
  { label: "Requirements", href: "/crew/requirements", icon: ClipboardCheck },
  { label: "Documents", href: "/crew/documents", icon: FileText },
  { label: "Profile", href: "/crew/profile", icon: UserRound },
  { label: "Availability", href: "/crew/availability", icon: CalendarDays },
] as const;

export function CrewPortalShell({ children, active = "Home" }: { children: React.ReactNode; active?: string }) {
  return <AuthBoundary area="crew"><WorkspaceProvider area="crew"><CrewShell active={active}>{children}</CrewShell></WorkspaceProvider></AuthBoundary>;
}

function CrewShell({ children, active }: { children: React.ReactNode; active: string }) {
  const workspace = useWorkspace();
  return <div className="crew-portal-frame">
    <aside className="crew-portal-sidebar" id="crew-navigation">
      <Link href="/crew"><Logo /></Link>
      <div className="crew-identity"><span className="avatar avatar-sand">{initials(workspace.userName)}</span><span><strong>{workspace.userName}</strong><small>Subcontractor</small></span></div>
      <nav aria-label="Crew portal navigation">{nav.map(item => { const Icon=item.icon; return <Link href={item.href} className={item.label===active?"crew-nav-active":""} key={item.label}><Icon size={17}/><span>{item.label}</span></Link> })}</nav>
      <div className="crew-privacy"><strong>Project-scoped access</strong><small>Only assigned jobs, contacts, documents, and schedule segments are shown.</small></div>
    </aside>
    <main className="crew-portal-content"><header><a className="mobile-menu" href="#crew-navigation" aria-label="Open crew navigation"><Menu size={20}/></a><span>{workspace.tenantName} crew workspace</span><SignOutButton/></header>{children}</main>
  </div>;
}
