import { Suspense } from "react";
import { PartnersPage } from "@/components/console/pages/partners-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PartnersPage />
    </Suspense>
  );
}
