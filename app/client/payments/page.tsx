import { LiveClientPayments } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientPaymentsPage() {
  return (
    <PortalShell active="Payments">
      <LiveClientPayments />
    </PortalShell>
  );
}
