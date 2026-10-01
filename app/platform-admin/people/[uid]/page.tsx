import { Suspense } from "react";
import { PersonRecord } from "@/components/console/pages/person-record";

export default async function Page({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  return (
    <Suspense fallback={null}>
      <PersonRecord uid={decodeURIComponent(uid)} />
    </Suspense>
  );
}
