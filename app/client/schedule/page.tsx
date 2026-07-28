import { LiveClientSchedule } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientSchedulePage() {
  return (
    <PortalShell active="Schedule">
      <LiveClientSchedule />
    </PortalShell>
  );
}
