import {
  Activity,
  BadgePercent,
  Handshake,
  Building2,
  ChartColumn,
  CircleCheckBig,
  CircleDot,
  Compass,
  CreditCard,
  DatabaseZap,
  Flag,
  HeartPulse,
  House,
  Inbox,
  LifeBuoy,
  Plug,
  ScrollText,
  Settings,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";

/**
 * The Console's sections, in rail order. Also what ⌘K offers as pages.
 *
 * Conor, 2026-10-07: the Console leads with growth and customers. Grow and
 * Customers come first; the machinery (jobs, integrations, health, flags,
 * audit) sits in System, folded away until something there needs a person.
 */
type NavItem = { label: string; href: string; icon: typeof House; count?: "inbox" | "tasks" | "jobs" | "data" | "studios" | "pipeline" };

export const CONSOLE_NAV: Array<{ group: string | null; collapsible?: boolean; items: NavItem[] }> = [
  { group: null, items: [{ label: "Home", href: "/platform-admin", icon: House }] },
  {
    group: "Grow",
    items: [
      { label: "Pipeline", href: "/platform-admin/pipeline", icon: Target, count: "pipeline" },
      { label: "Sources", href: "/platform-admin/sources", icon: Compass },
      { label: "Partners", href: "/platform-admin/partners", icon: Handshake },
      { label: "Discount codes", href: "/platform-admin/codes", icon: BadgePercent },
    ],
  },
  {
    group: "Customers",
    items: [
      { label: "Studios", href: "/platform-admin/studios", icon: Building2, count: "studios" },
      { label: "Lifecycle", href: "/platform-admin/lifecycle", icon: HeartPulse },
      { label: "People", href: "/platform-admin/people", icon: Users },
      { label: "Inbox", href: "/platform-admin/inbox", icon: Inbox, count: "inbox" },
      { label: "Issues", href: "/platform-admin/issues", icon: CircleDot },
      { label: "Tasks", href: "/platform-admin/tasks", icon: CircleCheckBig, count: "tasks" },
    ],
  },
  {
    group: "Money",
    items: [
      { label: "Revenue", href: "/platform-admin/revenue", icon: ChartColumn },
      { label: "Subscriptions", href: "/platform-admin/subscriptions", icon: CreditCard },
    ],
  },
  {
    group: "System",
    collapsible: true,
    items: [
      { label: "Jobs", href: "/platform-admin/jobs", icon: TriangleAlert, count: "jobs" },
      { label: "Integrations", href: "/platform-admin/integrations", icon: Plug },
      { label: "System health", href: "/platform-admin/health", icon: Activity },
      { label: "Data requests", href: "/platform-admin/data-requests", icon: DatabaseZap, count: "data" },
      { label: "Feature access", href: "/platform-admin/features", icon: Flag },
      { label: "Audit log", href: "/platform-admin/audit", icon: ScrollText },
      { label: "Support sessions", href: "/platform-admin/support", icon: LifeBuoy },
      { label: "Settings", href: "/platform-admin/settings", icon: Settings },
    ],
  },
];
