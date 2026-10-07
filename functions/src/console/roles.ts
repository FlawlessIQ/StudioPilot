/**
 * Who may do what in the StudioCue Console (docs/console.md).
 *
 * Mirror of features/console/roles.ts — functions/ is a separate package with
 * no "@/features" path. tests/console-roles.test.ts compares the two below the
 * header, so they cannot drift.
 *
 * The browser uses its copy only to decide which buttons to draw. This copy is
 * the authority: every console command names the capability it needs, and
 * saasAdminCommand refuses before the handler runs.
 */
export const CONSOLE_ROLES = ["owner", "operator", "support", "viewer"] as const;
export type ConsoleRole = (typeof CONSOLE_ROLES)[number];

export const CONSOLE_ROLE_LABELS: Record<ConsoleRole, string> = {
  owner: "Owner",
  operator: "Operator",
  support: "Support",
  viewer: "Viewer",
};

export const CONSOLE_ROLE_SUMMARIES: Record<ConsoleRole, string> = {
  owner: "Everything, including admins, suspension and deletion approval.",
  operator: "Studios, billing, discount codes, jobs and feature access.",
  support: "Studios, people and the inbox. No billing changes.",
  viewer: "Read-only.",
};

export type ConsoleCapability =
  | "console.read"
  | "crm.write"
  | "people.support"
  | "people.manage"
  | "inbox.write"
  | "billing.write"
  | "codes.write"
  | "partners.write"
  | "ops.write"
  | "features.write"
  | "support.session"
  | "studios.suspend"
  | "deletion.approve"
  | "admins.manage"
  | "settings.write";

const EVERYONE: readonly ConsoleRole[] = ["owner", "operator", "support", "viewer"];
const STAFF: readonly ConsoleRole[] = ["owner", "operator", "support"];
const OPERATORS: readonly ConsoleRole[] = ["owner", "operator"];
const OWNER: readonly ConsoleRole[] = ["owner"];

export const CONSOLE_CAPABILITIES: Record<ConsoleCapability, readonly ConsoleRole[]> = {
  "console.read": EVERYONE,
  "crm.write": STAFF,
  "people.support": STAFF,
  "people.manage": OPERATORS,
  "inbox.write": STAFF,
  "billing.write": OPERATORS,
  "codes.write": OPERATORS,
  "partners.write": OPERATORS,
  "ops.write": OPERATORS,
  "features.write": OPERATORS,
  "support.session": STAFF,
  "studios.suspend": OWNER,
  "deletion.approve": OWNER,
  "admins.manage": OWNER,
  "settings.write": OPERATORS,
};

export function isConsoleRole(value: unknown): value is ConsoleRole {
  return CONSOLE_ROLES.includes(value as ConsoleRole);
}

/**
 * The console role a set of token claims carries, or null for no access.
 *
 * `platformAdmin: true` stays the gate every Firestore rule checks, so it is
 * required here too. An admin from before roles existed has the claim and no
 * `platformRole`; they were set by hand by the person who owns the platform,
 * so they read as owner.
 */
export function roleFromClaims(claims: Record<string, unknown> | null | undefined): ConsoleRole | null {
  if (!claims || claims.platformAdmin !== true) return null;
  return isConsoleRole(claims.platformRole) ? claims.platformRole : "owner";
}

export function roleCan(role: ConsoleRole | null, capability: ConsoleCapability): boolean {
  return role !== null && CONSOLE_CAPABILITIES[capability].includes(role);
}
