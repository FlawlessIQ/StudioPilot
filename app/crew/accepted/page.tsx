import { redirect } from "next/navigation";

/**
 * Superseded by /crew/jobs when the crew nav collapsed "Accepted jobs" into
 * "Jobs". tests/route-reachability.test.ts had it listed as "dead, pending
 * deletion"; the page rendered the same brief as /crew/schedule with the same
 * two buttons, so a third copy of it was nothing to keep. Kept as an alias so
 * a typed or bookmarked URL never dead-ends on a 404.
 */
export default function AcceptedJobsAlias() {
  redirect("/crew/jobs");
}
