import { ClientDelivery } from "@/components/client/kit/client-delivery";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientDeliveryPage() {
  return (
    <PortalShell active="Delivery">
      <ClientDelivery />
    </PortalShell>
  );
}
