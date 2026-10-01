import {
  Activity,
  BadgePercent,
  Building2,
  ChartColumn,
  CircleCheckBig,
  CircleDot,
  CreditCard,
  DatabaseZap,
  Flag,
  House,
  Inbox,
  LifeBuoy,
  Plug,
  ScrollText,
  Settings,
  TriangleAlert,
  Users,
} from "lucide-react";

/** The Console's sections, in rail order. Also what ⌘K offers as pages. */
type NavItem = { label: string; href: string; icon: typeof House; count?: "inbox" | "tasks" | "jobs" | "data" | "studios" };

export const CONSOLE_NAV: Array<{ group: string | null; items: NavItem[] }> = [
  { group: null, items: [{ label: "Home", href: "/platform-admin", icon: House }] },
  {
    group: "CRM",
    items: [
      { label: "Studios", href: "/platform-admin/studios", icon: Building2, count: "studios" },
      { label: "People", href: "/platform-admin/people", icon: Users },
      { label: "Inbox", href: "/platform-admin/inbox", icon: Inbox, count: "inbox" },
      { label: "Issues", href: "/platform-admin/issues", icon: CircleDot },
      { label: "Tasks", href: "/platform-admin/tasks", icon: CircleCheckBig, count: "tasks" },
    ],
  },
  {
    group: "Billing",
    items: [
      { label: "Subscriptions", href: "/platform-admin/subscriptions", icon: CreditCard },
      { label: "Discount codes", href: "/platform-admin/codes", icon: BadgePercent },
      { label: "Revenue", href: "/platform-admin/revenue", icon: ChartColumn },
    ],
  },
  {
    group: "Operations",
    items: [
      { label: "Jobs", href: "/platform-admin/jobs", icon: TriangleAlert, count: "jobs" },
      { label: "Integrations", href: "/platform-admin/integrations", icon: Plug },
      { label: "System health", href: "/platform-admin/health", icon: Activity },
      { label: "Data requests", href: "/platform-admin/data-requests", icon: DatabaseZap, count: "data" },
    ],
  },
  {
    group: "Platform",
    items: [
      { label: "Feature access", href: "/platform-admin/features", icon: Flag },
      { label: "Audit log", href: "/platform-admin/audit", icon: ScrollText },
      { label: "Support sessions", href: "/platform-admin/support", icon: LifeBuoy },
      { label: "Settings", href: "/platform-admin/settings", icon: Settings },
    ],
  },
];

