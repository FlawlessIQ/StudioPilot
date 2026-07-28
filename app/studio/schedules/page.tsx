import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function SchedulesPage() {
  return (
    <AppShell active="Schedules">
      <StudioDomainPage
        domain="schedules"
        eyebrow="Run of show"
        title="Schedules"
        description="Build, review, publish, and track approval of each project’s run of show."
        action={{ href: "/studio/schedules/new", label: "Generate schedule" }}
      />
    </AppShell>
  );
}
