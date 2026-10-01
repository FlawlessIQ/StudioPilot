import { Suspense } from "react";
import { InboxPage } from "@/components/console/pages/inbox-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InboxPage />
    </Suspense>
  );
}
