"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardCheck,
  FileCheck2,
  FolderKanban,
  Send,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";

const links = [
  { label: "Overview", route: "projects", icon: Sparkles },
  { label: "Tasks", route: "tasks", icon: ClipboardCheck },
  { label: "Client details", route: "questionnaires", icon: UserRound },
  { label: "Booking", route: "contracts", icon: FileCheck2 },
  { label: "Planning", route: "vendors", icon: FolderKanban },
  { label: "Crew", route: "crew", icon: UsersRound },
  { label: "Schedule", route: "schedules", icon: CalendarDays },
  { label: "Files", route: "documents", icon: Send },
] as const;

export function ProjectWorkspaceNav({
  projectId,
  compact = false,
}: {
  projectId: string;
  compact?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Project workspace"
      className={compact ? "project-workspace-nav is-contextual" : "project-workspace-nav"}
    >
      {links.map((item) => {
        const Icon = item.icon;
        const href =
          item.route === "projects"
            ? `/studio/projects/${projectId}`
            : `/studio/${item.route}?project=${projectId}`;
        const active =
          item.route === "projects"
            ? pathname === `/studio/projects/${projectId}`
            : pathname === `/studio/${item.route}`;
        return (
          <Link className={active ? "active" : ""} href={href} key={item.label}>
            <Icon aria-hidden="true" size={14} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
