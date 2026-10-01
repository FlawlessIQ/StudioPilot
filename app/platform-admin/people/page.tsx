import { Suspense } from "react";
import { PeoplePage } from "@/components/console/pages/people-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PeoplePage />
    </Suspense>
  );
}
