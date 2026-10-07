import { Suspense } from "react";
import { PipelinePage } from "@/components/console/pages/pipeline-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PipelinePage />
    </Suspense>
  );
}
