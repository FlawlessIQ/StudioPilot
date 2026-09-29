import { redirect } from "next/navigation";

/**
 * The checklist and documents live on the job now (M6 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md). Kept as an alias so
 * links in older emails and requirement rows land on the job's checklist.
 */
export default async function CrewRequirementsAlias({
  searchParams,
}: {
  searchParams: Promise<{ assignment?: string }>;
}) {
  const { assignment } = await searchParams;
  redirect(assignment ? `/crew/prep?assignment=${encodeURIComponent(assignment)}#checklist` : "/crew/prep#checklist");
}
