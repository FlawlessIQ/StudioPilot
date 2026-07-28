import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewPending } from "@/components/crew/live-crew-views";

export default function PendingJobsPage() {
  return (
    <CrewPortalShell active="Pending jobs">
      <LiveCrewPending />
    </CrewPortalShell>
  );
}
