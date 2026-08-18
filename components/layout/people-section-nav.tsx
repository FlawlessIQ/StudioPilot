"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ContactRound, Camera, UsersRound } from "lucide-react";

/**
 * The People section's own navigation.
 *
 * The sidebar groups Clients, Crew, Team and Vendors under one "People" item,
 * but that item links only to Clients and the page offered no route to the
 * other three — so /studio/crew, /studio/team and /studio/vendors were
 * reachable only by typing the URL.
 */
const links = [
  { label: "Clients", href: "/studio/clients", icon: ContactRound },
  { label: "Crew", href: "/studio/crew", icon: Camera },
  { label: "Team", href: "/studio/team", icon: UsersRound },
  { label: "Vendors", href: "/studio/vendors", icon: Building2 },
] as const;

export function PeopleSectionNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="People" className="section-nav">
      {links.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "active" : ""}
            href={item.href}
            key={item.href}
          >
            <Icon aria-hidden="true" size={14} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
