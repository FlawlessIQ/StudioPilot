import { ClientSchedule } from "@/components/client/kit/client-schedule";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientSchedulePage() {
  return (
    <PortalShell active="Schedule">
      <ClientSchedule />
    </PortalShell>
  );
}
