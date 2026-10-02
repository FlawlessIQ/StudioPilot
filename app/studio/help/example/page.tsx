import { redirect } from "next/navigation";

/**
 * The annotated example job lived here until "A wedding, start to finish"
 * replaced it: the whole wedding, not one moment of it. Kept so a bookmarked
 * or linked URL never dead-ends on a 404.
 */
export default function ExampleJobAlias() {
  redirect("/studio/help/journey");
}
