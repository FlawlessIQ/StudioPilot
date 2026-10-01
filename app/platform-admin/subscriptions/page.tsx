import { Suspense } from "react";
import { SubscriptionsPage } from "@/components/console/pages/subscriptions-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SubscriptionsPage />
    </Suspense>
  );
}
