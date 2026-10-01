import { Suspense } from "react";
import { JobsPage } from "@/components/console/pages/jobs-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <JobsPage />
    </Suspense>
  );
}
