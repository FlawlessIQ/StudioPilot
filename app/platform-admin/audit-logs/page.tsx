import { redirect } from "next/navigation";

/** Moved to Audit log in the Console (docs/console.md). */
export default function Page() {
  redirect("/platform-admin/audit");
}
