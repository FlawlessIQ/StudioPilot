import { ClientHome } from "@/components/client/kit/client-home";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientPortalPage() {
  return (
    <PortalShell>
      <ClientHome />
    </PortalShell>
  );
}
