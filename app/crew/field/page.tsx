"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { EventFieldMode } from "@/components/group-events/event-field-mode";

/**
 * Field mode for the crew assigned to a group event: the roster and payments
 * at the field (crmCommand lets crew record a payment and nothing else).
 * Reached from their job page.
 */
function CrewField() {
  const projectId = useSearchParams().get("project") ?? "";
  if (!projectId) return <p className="form-notice">Open field mode from your job.</p>;
  return <EventFieldMode backHref="/crew/jobs" projectId={projectId} />;
}

export default function CrewFieldPage() {
  return (
    <Suspense fallback={null}>
      <CrewField />
    </Suspense>
  );
}
