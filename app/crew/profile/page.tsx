import { redirect } from "next/navigation";

/** Profile and account are one screen, Me (M6). Alias for old links. */
export default function CrewProfileAlias() {
  redirect("/crew/account");
}
