import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ProjectContextBar } from "@/components/studio/live-domain-view";
import { PlanAreas } from "@/components/projects/plan-areas";

export const metadata: Metadata = { title: "Project planning" };


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
          <PlanAreas projectId={project} />
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
