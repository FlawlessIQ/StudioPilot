import { PortalShell } from "@/components/layout/portal-shell";
import { ClientShotList } from "@/components/client/kit/client-shot-list";

export default function ClientShotListPage() {
  return (
    <PortalShell active="Plan">
      <ClientShotList />
    </PortalShell>
  );
}
