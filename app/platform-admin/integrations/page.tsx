import { Suspense } from "react";
import { IntegrationsPage } from "@/components/console/pages/integrations-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <IntegrationsPage />
    </Suspense>
  );
}
