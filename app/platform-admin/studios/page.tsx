import { Suspense } from "react";
import { StudiosPage } from "@/components/console/pages/studios-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StudiosPage />
    </Suspense>
  );
}
