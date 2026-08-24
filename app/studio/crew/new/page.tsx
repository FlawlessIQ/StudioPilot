import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { CreateCrewProfileForm } from "@/components/crew/create-crew-profile-form";

export default function NewCrewProfilePage() {
  return (
    <AppShell active="Crew">
      {/* One measure for the heading rule and the panel below it. The rule
          used to run 150px past the right edge of the only card on the page. */}
      <div className="crew-ops-page crew-ops-page-single">
        <Link className="back-link" href="/studio/crew">
          <ArrowLeft size={15} /> Back to crew
        </Link>
        <header className="page-heading">
          <div>
            <p className="eyebrow">Crew directory</p>
            <h1>Add crew member</h1>
            <p>
              Save their working details, then offer them a specific job from
              that job&rsquo;s crew plan.
            </p>
          </div>
        </header>
        {/* The form owns its panel so that the confirmation can replace it
            outright, rather than nesting a second panel inside this one. */}
        <CreateCrewProfileForm />
      </div>
    </AppShell>
  );
}
