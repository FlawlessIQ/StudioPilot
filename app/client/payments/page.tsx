import { ClientPayments } from "@/components/client/kit/client-payments";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientPaymentsPage() {
  return (
    <PortalShell active="Payments">
      <ClientPayments />
    </PortalShell>
  );
}
