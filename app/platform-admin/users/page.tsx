import { redirect } from "next/navigation";

/** Renamed to People in the Console (docs/console.md). Old links still land. */
export default function Page() {
  redirect("/platform-admin/people");
}
