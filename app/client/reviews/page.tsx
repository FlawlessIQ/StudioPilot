import { ClientReviews } from "@/components/client/kit/client-reviews";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientReviewsPage() {
  return (
    <PortalShell active="Reviews">
      <ClientReviews />
    </PortalShell>
  );
}
