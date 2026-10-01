import { redirect } from "next/navigation";

/** Renamed to Studios in the Console (docs/console.md). Old links still land. */
export default function Page() {
  redirect("/platform-admin/studios");
}
