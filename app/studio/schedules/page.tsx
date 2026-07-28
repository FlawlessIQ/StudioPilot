import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function SchedulesPage() {
  return (
    <AppShell active="Schedules">
      <StudioDomainPage
        domain="schedules"
        eyebrow="Run of show"
        title="Schedules"
        description="Immutable published versions with client approval and current-version crew acknowledgement."
        action={{ href: "/studio/schedules/new", label: "Generate schedule" }}
      />
    </AppShell>
  );
}
