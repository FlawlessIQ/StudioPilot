import Link from "next/link";
import { UserPlus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { CrewCascadeWorkspace } from "@/components/crew/crew-cascade-workspace";
import { CrewHub } from "@/components/crew/crew-hub";
import { DirectInviteForm } from "@/components/crew/direct-invite-form";
import {
  LiveDomainView,
  ProjectContextBar,
} from "@/components/studio/live-domain-view";
import { PeopleSectionNav } from "@/components/layout/people-section-nav";

export default async function StudioCrewPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; view?: string }>;
}) {
  const { project, view } = await searchParams;
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
        {project ? (
          <>
            {/* One job's crew plan: who to ask for each role, and the offers
                already made for it. */}
            <ProjectContextBar projectId={project} />
            <CrewCascadeWorkspace projectId={project} />
            <DirectInviteForm projectId={project} />
            <section>
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">This job</p>
                  <h2>Offers and assignments</h2>
                </div>
              </div>
              <LiveDomainView domain="crew_assignments" projectId={project} />
            </section>
          </>
        ) : (
          // Staff a job, then the people and their work as tabs — see
          // components/crew/crew-hub.tsx. "Crew" are the people you hire for a
          // job; "Team" are the people in your studio.
          <CrewHub initialView={view === "assignments" ? "assignments" : "crew"} />
        )}
      </div>
    </AppShell>
  );
}
