import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewJobs } from "@/components/crew/live-crew-views";

export default function CrewJobsPage() {
  return <CrewPortalShell active="Jobs"><LiveCrewJobs /></CrewPortalShell>;
}
