import { LiveClientDelivery } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientDeliveryPage() {
  return (
    <PortalShell active="Delivery">
      <LiveClientDelivery />
    </PortalShell>
  );
}
