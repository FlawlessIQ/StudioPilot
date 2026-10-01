import { Suspense } from "react";
import { FeaturesPage } from "@/components/console/pages/features-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <FeaturesPage />
    </Suspense>
  );
}
