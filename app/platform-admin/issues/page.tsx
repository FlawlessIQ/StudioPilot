import { Suspense } from "react";
import { IssuesPage } from "@/components/console/pages/issues-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <IssuesPage />
    </Suspense>
  );
}
