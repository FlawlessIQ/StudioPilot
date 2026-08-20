"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderKanban,
  HandCoins,
  Images,
  Sparkles,
} from "lucide-react";

const links = [
  { label: "Overview", route: "projects", icon: Sparkles },
  { label: "Booking", route: "booking", icon: HandCoins },
  { label: "Plan", route: "planning", icon: FolderKanban },
  { label: "Delivery", route: "delivery", icon: Images },
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
            : item.route === "booking"
              ? `/studio/booking?project=${projectId}`
              : item.route === "planning"
                ? `/studio/planning?project=${projectId}`
                : `/studio/delivery?project=${projectId}`;
        const active =
          item.route === "projects"
            ? pathname === `/studio/projects/${projectId}`
            : item.route === "booking"
              ? ["/studio/booking", "/studio/proposals", "/studio/contracts", "/studio/invoices"].includes(pathname)
              : item.route === "planning"
                ? ["/studio/planning", "/studio/questionnaires", "/studio/vendors", "/studio/crew", "/studio/schedules", "/studio/documents", "/studio/insurance", "/studio/event-day"].includes(pathname)
                : ["/studio/post-production", "/studio/delivery", "/studio/reviews"].includes(pathname);
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
