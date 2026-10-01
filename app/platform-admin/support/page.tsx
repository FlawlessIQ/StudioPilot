import { Suspense } from "react";
import { SupportPage } from "@/components/console/pages/support-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SupportPage />
    </Suspense>
  );
}
