import { LiveClientReviews } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientReviewsPage() {
  return (
    <PortalShell active="Reviews">
      <LiveClientReviews />
    </PortalShell>
  );
}
