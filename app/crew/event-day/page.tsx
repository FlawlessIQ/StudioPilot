import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { LiveCrewSchedule } from "@/components/crew/live-crew-views";

export default function CrewEventDayPage() {
  return <CrewPortalShell active="Schedule & prep"><LiveCrewSchedule context="event-day" /></CrewPortalShell>;
}
