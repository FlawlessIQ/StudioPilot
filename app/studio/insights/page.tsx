import { redirect } from "next/navigation";

/**
 * The sidebar label is "Insights"; the canonical route is /studio/reports.
 * Keep this alias so typed or stale URLs never dead-end on a 404.
 */
export default function InsightsAlias() {
  redirect("/studio/reports");
}
