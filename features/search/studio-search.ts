import { SETTINGS_SECTIONS } from "@/features/settings/sections";
import { explainersFor } from "@/features/help/explainers";
import { rolePermissions, type Role } from "@/features/auth/roles";

export type StudioSearchResult = {
  id: string;
  label: string;
  detail: string;
  href: string;
  kind: "Project" | "Inquiry" | "Client" | "Task" | "Contract" | "Schedule" | "Message" | "Approval" | "Package" | "Action" | "Settings" | "Help";
  searchText?: string;
};

const normalize = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Match all meaningful words, regardless of their order, with common plurals. */
export function searchStudio(values: StudioSearchResult[], query: string): StudioSearchResult[] {
  const needle = normalize(query);
  const tokens = needle.split(" ");
  // A single word such as “An” or “Do” may be a client's name.
  const words = tokens.length === 1 ? tokens : tokens.filter((word) => !["how", "do", "i", "to", "my", "the", "a", "an", "where", "can"].includes(word));
  if (!needle || !words.length) return [];
  return values.map((result, index) => {
    const label = normalize(result.label);
    const haystack = normalize(`${result.label} ${result.detail} ${result.kind} ${result.searchText ?? ""}`);
    const matches = (text: string) => words.every((word) => text.includes(word) || (word.endsWith("s") && text.includes(word.slice(0, -1))) || (word.length > 5 && word.endsWith("ing") && text.includes(word.slice(0, -3))));
    return { result, index, score: !matches(haystack) ? -1 : label === needle ? 3 : matches(label) ? 2 : 1 };
  }).filter((entry) => entry.score >= 0).sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.result);
}

/** Destinations are searchable even when the studio has no records yet. */
export function studioSearchDestinations(role: Role | null, trade?: unknown): StudioSearchResult[] {
  const permissions = role ? rolePermissions[role] : [];
  const can = (permission: (typeof permissions)[number]) => permissions.includes(permission);
  const destinations: StudioSearchResult[] = [
    { id: "today", kind: "Action", label: "Review prepared work", detail: "Replies and decisions waiting on Today", href: "/studio", searchText: "approve drafts today inbox" },
    { id: "jobs", kind: "Action", label: "Find a job", detail: "Browse your jobs", href: "/studio/projects", searchText: "projects weddings bookings" },
    { id: "help", kind: "Help", label: "Help and guides", detail: "Learn how to use StudioCue", href: "/studio/help", searchText: "support instructions tutorials" },
  ];
  if (can("projects.manage")) destinations.push({ id: "new-job", kind: "Action", label: "New job", detail: "Create a job", href: "/studio/projects/new", searchText: "add create project booking" });
  if (can("clients.manage")) destinations.push({ id: "new-client", kind: "Action", label: "Add client", detail: "Create a client contact", href: "/studio/clients/new", searchText: "new person customer" });
  if (can("schedules.manage")) destinations.push(
    { id: "calendar", kind: "Action", label: "Schedule a call or appointment", detail: "Find a time on your calendar", href: "/studio/calendar", searchText: "book meeting trial consultation availability" },
    { id: "new-schedule", kind: "Action", label: "Draft a run of show", detail: "Create a schedule to review", href: "/studio/schedules/new", searchText: "add new timeline" },
  );
  if (can("packages.manage")) destinations.push(
    { id: "add-package", kind: "Action", label: "Add a package", detail: "Create a package with your services and prices", href: "/studio/packages/new", searchText: "add packages create new pricing offerings" },
    { id: "packages", kind: "Settings", label: "Manage packages", detail: "Edit your services and prices", href: "/studio/packages", searchText: "update package pricing offerings" },
  );
  if (can("integrations.manage")) destinations.push({ id: "integrations", kind: "Settings", label: "Connected tools", detail: "Connect or reconnect QuickBooks, calendars, Zoom and Dropbox", href: "/studio/integrations", searchText: "integrations accounting payments google outlook apple" });
  if (can("tenant.manage") || role === "studio_admin") destinations.push(...SETTINGS_SECTIONS.map((section) => ({
    id: `settings-${section.key}`, kind: "Settings" as const, label: section.title, detail: section.subtitle, href: `/studio/settings/${section.slug}`, searchText: `settings ${section.key}`,
  })));
  if (can("subscription.manage")) destinations.push({ id: "subscription", kind: "Settings", label: "Subscription", detail: "Manage your StudioCue plan and billing", href: "/studio/subscription", searchText: "upgrade cancel trial card" });
  destinations.push(...explainersFor(trade).filter((guide) => guide.audience === "studio").map((guide) => ({
    id: `help-${guide.id}`, kind: "Help" as const, label: guide.title, detail: guide.summary, href: `/studio/help?howto=${encodeURIComponent(guide.id)}`,
  })));
  return destinations;
}
