import { redirect } from "next/navigation";

/** Moved to System health in the Console (docs/console.md). */
export default function Page() {
  redirect("/platform-admin/health");
}
