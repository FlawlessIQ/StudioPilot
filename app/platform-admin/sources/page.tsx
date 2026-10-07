import { Suspense } from "react";
import { SourcesPage } from "@/components/console/pages/sources-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SourcesPage />
    </Suspense>
  );
}
