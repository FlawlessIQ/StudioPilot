import { Suspense } from "react";
import { CodesPage } from "@/components/console/pages/codes-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CodesPage />
    </Suspense>
  );
}
