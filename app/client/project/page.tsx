import { LiveClientProjectDetails } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientProjectPage() {
  return (
    <PortalShell active="Project details">
      <LiveClientProjectDetails />
    </PortalShell>
  );
}
