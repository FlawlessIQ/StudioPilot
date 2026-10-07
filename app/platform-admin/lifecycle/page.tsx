import { Suspense } from "react";
import { LifecyclePage } from "@/components/console/pages/lifecycle-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LifecyclePage />
    </Suspense>
  );
}
