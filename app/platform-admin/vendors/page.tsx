import { Suspense } from "react";
import { VendorsPage } from "@/components/console/pages/vendors-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <VendorsPage />
    </Suspense>
  );
}
