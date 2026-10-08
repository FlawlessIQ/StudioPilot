import { Suspense } from "react";
import { ReferralsPage } from "@/components/console/pages/referrals-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReferralsPage />
    </Suspense>
  );
}
