import Link from "next/link";
import { ArrowRight, CircleCheck, Clock3, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";

type ModuleConfig = {
  title: string;
  description: string;
  active: string;
  action: string;
  rows: readonly {
    name: string;
    detail: string;
    status: string;
    tone: "success" | "warning" | "neutral" | "info";
  }[];
};

const modules: Readonly<Record<string, ModuleConfig>> = {
  leads: {
    title: "Leads",
    description: "Track inquiries from first contact through consultation.",
    active: "Leads",
    action: "Open inquiry form",
    rows: [
      { name: "Lena & Chris", detail: "Wedding · October 3", status: "New", tone: "info" },
      { name: "Hearthwell Brands", detail: "Corporate · Product launch", status: "Consultation", tone: "warning" },
      { name: "Noah & Elise", detail: "Wedding · Referred by venue", status: "Follow-up", tone: "neutral" },
    ],
  },
  projects: {
    title: "Projects",
    description: "All active work, states, owners, and readiness blockers.",
    active: "Projects",
    action: "Create project",
    rows: [
      { name: "Maya & Theo Johnson", detail: "Aug 15 · Wedding", status: "72% ready", tone: "warning" },
      { name: "Sofia & Miles Carter", detail: "Aug 22 · Wedding", status: "Ready", tone: "success" },
      { name: "Northstar Annual Summit", detail: "Sep 4 · Corporate", status: "Booked", tone: "info" },
    ],
  },
  calendar: {
    title: "Calendar",
    description: "Consultations, production events, and crew commitments.",
    active: "Calendar",
    action: "Connect calendar",
    rows: [
      { name: "Lena & Chris consultation", detail: "Today · 10:30 AM · Zoom", status: "Confirmed", tone: "success" },
      { name: "Johnson final review", detail: "Tomorrow · 2:00 PM", status: "Awaiting client", tone: "warning" },
      { name: "Carter wedding", detail: "Aug 22 · Cedar Lakes Estate", status: "Production", tone: "info" },
    ],
  },
  clients: {
    title: "Clients",
    description: "People, project relationships, portal access, and communication history.",
    active: "Clients",
    action: "Add client",
    rows: [
      { name: "Maya Johnson", detail: "Johnson wedding · Portal active", status: "Active", tone: "success" },
      { name: "Sofia Carter", detail: "Carter wedding · Portal active", status: "Active", tone: "success" },
      { name: "Ellis Grant", detail: "Northstar · Corporate approver", status: "Invited", tone: "info" },
    ],
  },
  vendors: {
    title: "Vendors",
    description: "Reusable venue, planner, insurance, and production contacts.",
    active: "Vendors",
    action: "Add vendor",
    rows: [
      { name: "The Foundry", detail: "Venue · 3 projects", status: "COI required", tone: "warning" },
      { name: "Evergreen Planning", detail: "Planner · 5 projects", status: "Active", tone: "success" },
      { name: "Beacon Insurance", detail: "Insurance agent · 2 requests", status: "Active", tone: "success" },
    ],
  },
  crew: {
    title: "Crew",
    description: "Profiles, assignments, availability, documents, and acknowledgements.",
    active: "Crew",
    action: "Invite crew",
    rows: [
      { name: "Jamie Rivera", detail: "Second photographer · 4 assignments", status: "Available", tone: "success" },
      { name: "Jordan Reid", detail: "Lead photographer · 6 assignments", status: "Schedule pending", tone: "warning" },
      { name: "Morgan Lee", detail: "Photo assistant · 2 assignments", status: "Available", tone: "success" },
    ],
  },
  packages: {
    title: "Packages",
    description: "Versioned offerings, add-ons, retainers, and tenant-specific pricing.",
    active: "Packages",
    action: "Create package",
    rows: [
      { name: "The Signature Collection", detail: "8 hours · 2 photographers", status: "Active · v4", tone: "success" },
      { name: "The Essential Collection", detail: "6 hours · 1 photographer", status: "Active · v2", tone: "success" },
      { name: "Corporate Half Day", detail: "4 hours · Usage terms", status: "Draft · v1", tone: "neutral" },
    ],
  },
  workflows: {
    title: "Workflow templates",
    description: "Versioned triggers, checkpoints, actions, and completion evidence.",
    active: "Workflows",
    action: "Create workflow",
    rows: [
      { name: "Wedding Photography", detail: "38 checkpoints · v7", status: "Active", tone: "success" },
      { name: "Corporate Photography", detail: "19 checkpoints · v2", status: "Active", tone: "success" },
      { name: "Sports Photography", detail: "17 checkpoints · v1", status: "Review", tone: "warning" },
    ],
  },
  documents: {
    title: "Documents",
    description: "Secure project files, provider references, versions, and evidence.",
    active: "Documents",
    action: "Upload document",
    rows: [
      { name: "Johnson schedule v3.pdf", detail: "Schedule · 1.2 MB", status: "Published", tone: "success" },
      { name: "The Foundry COI.pdf", detail: "Insurance · 482 KB", status: "Under review", tone: "warning" },
      { name: "Carter contract.pdf", detail: "Docusign · Immutable", status: "Completed", tone: "success" },
    ],
  },
  integrations: {
    title: "Integrations",
    description: "Provider connections, sync health, and recent failures.",
    active: "Integrations",
    action: "Add connection",
    rows: [
      { name: "QuickBooks Online", detail: "Synced 12 minutes ago", status: "Healthy", tone: "success" },
      { name: "Google Calendar", detail: "Synced 4 minutes ago", status: "Healthy", tone: "success" },
      { name: "Docusign", detail: "Webhook received 31 minutes ago", status: "Healthy", tone: "success" },
    ],
  },
  notifications: {
    title: "Notifications",
    description: "Operational updates requiring review or acknowledgement.",
    active: "Dashboard",
    action: "Notification settings",
    rows: [
      { name: "Schedule approval requested", detail: "Johnson wedding · 8 minutes ago", status: "Unread", tone: "info" },
      { name: "COI discrepancy detected", detail: "The Foundry · 22 minutes ago", status: "Review", tone: "warning" },
      { name: "Retainer paid", detail: "Priya & Jordan · 41 minutes ago", status: "Complete", tone: "success" },
    ],
  },
  copilot: {
    title: "Studio Copilot",
    description: "Permission-aware answers grounded in your tenant’s records.",
    active: "Dashboard",
    action: "Start a question",
    rows: [
      { name: "Which weddings are not ready?", detail: "Checks deterministic readiness records", status: "Suggested", tone: "info" },
      { name: "What needs my attention today?", detail: "Summarizes tasks, blockers, and responses", status: "Suggested", tone: "info" },
      { name: "Draft a reminder to this client", detail: "Requires review before sending", status: "Guarded action", tone: "warning" },
    ],
  },
  settings: {
    title: "Studio settings",
    description: "Business identity, branding, defaults, permissions, and security.",
    active: "Dashboard",
    action: "Review security",
    rows: [
      { name: "Business profile", detail: "Alder & Muse Photography", status: "Complete", tone: "success" },
      { name: "Team permissions", detail: "5 active internal users", status: "Configured", tone: "success" },
      { name: "Firebase App Check", detail: "Required for production commands", status: "Setup needed", tone: "warning" },
    ],
  },
};

export default async function StudioModulePage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const section = path[0] ?? "projects";
  const config = modules[section] ?? modules.projects;

  return (
    <AppShell active={config.active}>
      <div className="module-page">
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">Alder &amp; Muse</p>
            <h1>{config.title}</h1>
            <p>{config.description}</p>
          </div>
          <Link className="button button-dark" href={`#${section}-action`}>
            <Plus size={16} /> {config.action}
          </Link>
        </div>
        <section className="panel module-panel">
          <div className="panel-heading">
            <div><h2>Current activity</h2><p>Tenant-scoped records</p></div>
            <StatusBadge tone="success" dot>Live demo data</StatusBadge>
          </div>
          <div className="module-list">
            {config.rows.map((row) => (
              <article key={row.name}>
                <span className={row.tone === "success" ? "module-icon complete" : "module-icon"}>
                  {row.tone === "success" ? <CircleCheck size={17} /> : <Clock3 size={17} />}
                </span>
                <span><strong>{row.name}</strong><small>{row.detail}</small></span>
                <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
                <Link href={`#${row.name.toLowerCase().replaceAll(" ", "-")}`} aria-label={`Open ${row.name}`}>
                  <ArrowRight size={16} />
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section className="module-action-card" id={`${section}-action`}>
          <div>
            <p className="eyebrow">Development mode</p>
            <h2>{config.action}</h2>
            <p>
              This control is connected to the module route and its permission boundary.
              Provider-backed write execution activates when Firebase and the relevant
              integration credentials are configured.
            </p>
          </div>
          <StatusBadge tone="info">Mock provider ready</StatusBadge>
        </section>
      </div>
    </AppShell>
  );
}
