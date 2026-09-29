import { ClientEvent } from "@/components/client/kit/client-event";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientProjectPage() {
  return (
    <PortalShell active="Project details">
      <ClientEvent />
    </PortalShell>
  );
}
