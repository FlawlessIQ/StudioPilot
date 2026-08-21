import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  FileStack,
  Radio,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ProjectContextBar } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Project planning" };

const areas = [
  { label: "Client details", detail: "Review questionnaire answers and missing facts.", route: "questionnaires", icon: ClipboardList },
  { label: "Timeline", detail: "Generate, review, and publish the run of show.", route: "schedules", icon: CalendarClock },
  { label: "Crew", detail: "Fill roles and monitor acceptances.", route: "crew", icon: UsersRound },
  { label: "Venue & insurance", detail: "Confirm operational requirements and evidence.", route: "insurance", icon: ShieldCheck },
  { label: "Project files", detail: "Keep schedules, documents, and deliverables together.", route: "documents", icon: FileStack },
  { label: "Event Day", detail: "Open the live brief when coverage begins.", route: "event-day", icon: Radio },
] as const;

export default async function PlanningPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Planning">
      <div className="project-plan-hub">
        <header className="page-heading">
          <div>
            <p className="eyebrow">The job</p>
            <h1>Plan</h1>
            <p>One place for the client facts, timeline, crew, requirements, and files that make the event ready.</p>
          </div>
        </header>
        {project ? <ProjectContextBar projectId={project} /> : null}
        {project ? (
          <section className="project-plan-grid" aria-label="Planning areas">
            {areas.map((area) => {
              const Icon = area.icon;
              return (
                <Link href={`/studio/${area.route}?project=${project}`} key={area.label}>
                  <span><Icon size={19} /></span>
                  <div><strong>{area.label}</strong><small>{area.detail}</small></div>
                  <ArrowRight size={15} />
                </Link>
              );
            })}
          </section>
        ) : (
          <section className="panel project-plan-empty">
            <h2>Choose a project first</h2>
            <p>Planning stays attached to one project so every AI suggestion is grounded in the correct client and event.</p>
            <Link className="button" href="/studio/projects">Open projects <ArrowRight size={15} /></Link>
          </section>
        )}
      </div>
    </AppShell>
  );
}
