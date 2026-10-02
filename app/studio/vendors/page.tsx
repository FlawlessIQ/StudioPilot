import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";
import { VendorCreateForm } from "@/components/planning/vendor-create-form";
import { VendorReshareBanner } from "@/components/planning/vendor-reshare-banner";
import { PeopleSectionNav } from "@/components/layout/people-section-nav";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Vendors">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Project network</p>
            <h1>Vendors & venues</h1>
            <p>
              Keep the contacts, requirements, and project relationships your
              team needs in one operational view.
            </p>
          </div>
        </header>
        <PeopleSectionNav />
        {project ? <ProjectContextBar projectId={project} /> : null}
        {project ? <VendorReshareBanner projectId={project} /> : null}
        {/* Per-row editing and archiving — the two things this page could
            never do. See components/planning/vendor-record-actions.tsx. */}
        <LiveDomainView
          domain="vendors"
          projectId={project}
          rowActions="vendor"
        />
        <details className="creation-disclosure panel">
          <summary>Add a vendor or venue</summary>
          <VendorCreateForm />
        </details>
      </div>
    </AppShell>
  );
}
