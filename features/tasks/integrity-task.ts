/**
 * Where a safety-sweep task (functions/src/operations/integrity-sweep.ts) is
 * fixed, and the button that says so. Null for any other task.
 *
 * "Confirm the booking for Michelle Graziano and Kyle Clemency" opened the
 * task list, whose button was "Mark done": the studio clicked it, the
 * reminder vanished and the job stayed unbooked (GR, 2026-10-23). These close
 * themselves once the problem is gone, so they go straight to the fix.
 */
export function integrityTaskFix(task: Record<string, unknown>): { href: string; label: string } | null {
  if (task.source !== "integrity_check") return null;
  const projectId = typeof task.projectId === "string" ? task.projectId : "";
  const job = encodeURIComponent(projectId);
  const booking = `/studio/booking?project=${job}`;
  switch (task.integrityRule) {
    case "deposit_paid_not_booked":
      return { href: booking, label: "Confirm the booking" };
    case "signed_no_deposit":
      return { href: booking, label: "Send the deposit invoice" };
    case "signed_not_advanced":
      return { href: booking, label: "Open the booking" };
    default:
      return { href: projectId ? `/studio/projects/${job}` : "/studio/tasks", label: "Open the job" };
  }
}
