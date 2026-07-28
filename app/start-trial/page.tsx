import { redirect } from "next/navigation";

export default function StartTrialPage() {
  redirect("/auth/register");
}
