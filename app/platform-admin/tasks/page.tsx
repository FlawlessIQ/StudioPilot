import { Suspense } from "react";
import { TasksPage } from "@/components/console/pages/tasks-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <TasksPage />
    </Suspense>
  );
}
