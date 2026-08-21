import Link from "next/link";
import { UserPlus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { CrewCascadeWorkspace } from "@/components/crew/crew-cascade-workspace";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";
import { PeopleSectionNav } from "@/components/layout/people-section-nav";

export default async function StudioCrewPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Crew">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Your people</p>
            <h1>Crew</h1>
            <p>
              Who you work with, what they have agreed to, and what they still
              owe you before a wedding.
            </p>
          </div>
          <Link className="button button-dark" href="/studio/crew/new">
            <UserPlus /> Add crew member
          </Link>
        </header>
        <PeopleSectionNav />
        {project ? <ProjectContextBar projectId={project} /> : null}
        {project ? <CrewCascadeWorkspace projectId={project} /> : null}
        <section>
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Upcoming work</p>
              <h2>Assignments</h2>
            </div>
          </div>
          <LiveDomainView domain="crew_assignments" projectId={project} />
        </section>
        <section>
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Directory</p>
              <h2>Collaborators</h2>
            </div>
          </div>
          <LiveDomainView domain="crew_profiles" />
        </section>
      </div>
    </AppShell>
  );
}
