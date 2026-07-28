"use client";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  Circle,
  CalendarCheck,
  Package,
  FolderKanban,
  UserPlus,
  ExternalLink,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";

type SetupStep = {
  label: string;
  detail: string;
  href: string;
  done: boolean;
  icon: typeof Circle;
};

export function SetupChecklist() {
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const { records: packages } = useTenantDocuments("packages");
  const { records: connections } = useTenantDocuments("integrationConnections");
  const { records: memberships } = useTenantDocuments("memberships");
  const calendarConnected = Boolean(
    connections?.some(
      (connection) =>
        connection.provider === "google_calendar" &&
        connection.status === "connected",
    ),
  );
  const steps: SetupStep[] = [
    {
      label: "Preview your inquiry form",
      detail: "Confirm your studio name and client-facing language.",
      href: workspace.tenantSlug
        ? `/inquiry?studio=${encodeURIComponent(workspace.tenantSlug)}`
        : "/studio/setup",
      done: Boolean(workspace.tenantSlug),
      icon: ExternalLink,
    },
    {
      label: "Create your first package",
      detail: "Add the offer you sell most often.",
      href: "/studio/packages/new",
      done: Boolean(packages?.length),
      icon: Package,
    },
    {
      label: "Connect your calendar",
      detail: "Prevent consultation and event-date conflicts.",
      href: "/studio/integrations",
      done: calendarConnected,
      icon: CalendarCheck,
    },
    {
      label: "Create your first project",
      detail: "Start with the client and event essentials.",
      href: "/studio/projects/new",
      done: Boolean(projects?.length),
      icon: FolderKanban,
    },
    {
      label: "Invite your team",
      detail: "Add a coordinator, admin, or photographer when ready.",
      href: "/studio/team",
      done: (memberships?.length ?? 0) > 1,
      icon: UserPlus,
    },
  ];
  const completed = steps.filter((step) => step.done).length;
  if (completed === steps.length) return null;
  const next = steps.find((step) => !step.done);

  return (
    <section className="setup-checklist">
      <header>
        <div>
          <p className="eyebrow">Get started</p>
          <h2>Set up your studio workspace</h2>
          <p>Complete these essentials to start moving real projects through StudioCue.</p>
        </div>
        <span className="setup-count">{completed} of {steps.length} complete</span>
      </header>
      <div className="setup-progress" aria-label={`${completed} of ${steps.length} setup steps complete`}>
        <i style={{ width: `${(completed / steps.length) * 100}%` }} />
      </div>
      <div className="setup-steps">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <Link className={step.done ? "complete" : ""} href={step.href} key={step.label}>
              <span>{step.done ? <Check size={16} /> : <Icon size={17} />}</span>
              <div><strong>{step.label}</strong><small>{step.detail}</small></div>
              <ArrowRight size={15} />
            </Link>
          );
        })}
      </div>
      {next ? <Link className="button button-dark" href={next.href}>Continue setup <ArrowRight size={16} /></Link> : null}
    </section>
  );
}
