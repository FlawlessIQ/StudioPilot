import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewPrep } from "@/components/crew/live-crew-views";

export default function CrewPrepPage() {
  return <CrewPortalShell active="Schedule & prep"><LiveCrewPrep /></CrewPortalShell>;
}
