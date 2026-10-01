import { Suspense } from "react";
import { AuditPage } from "@/components/console/pages/audit-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AuditPage />
    </Suspense>
  );
}
