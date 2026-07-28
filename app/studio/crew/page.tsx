import Link from "next/link";
import { UserPlus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { LiveDomainView } from "@/components/studio/live-domain-view";

export default function StudioCrewPage() {
  return (
    <AppShell active="Crew">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">People & assignments</p>
            <h1>Crew operations</h1>
            <p>
              Tenant-scoped collaborators, invitations, requirements, and
              schedule acknowledgements.
            </p>
          </div>
          <Link className="button button-dark" href="/studio/crew/new">
            <UserPlus /> Add crew member
          </Link>
        </header>
        <section>
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Upcoming work</p>
              <h2>Assignments</h2>
            </div>
          </div>
          <LiveDomainView domain="crew_assignments" />
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
