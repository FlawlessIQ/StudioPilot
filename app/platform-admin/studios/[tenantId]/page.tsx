import { Suspense } from "react";
import { StudioRecord } from "@/components/console/pages/studio-record";

export default async function Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return (
    <Suspense fallback={null}>
      <StudioRecord tenantId={decodeURIComponent(tenantId)} />
    </Suspense>
  );
}
