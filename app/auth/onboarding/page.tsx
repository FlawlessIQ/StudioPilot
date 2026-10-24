import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { OnboardingForm } from "@/features/auth/onboarding-form";

// The tab read "StudioCue · The office manager for photography studios",
// the marketing title, halfway through signup.
export const metadata: Metadata = { title: "Set up your studio" };

export default function OnboardingPage() {
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-quote">
          <Logo />
          {/* It promised "a trial that starts the moment you do"; the trial
              starts at the card, a screen later. What naming the studio does
              do: functions/src/saas/onboarding.ts makes the inquiry form, the
              starter forms and the booking steps in the same write. */}
          <blockquote>
            Name your studio and your inquiry form, starter forms and booking steps are ready in
            seconds.
          </blockquote>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <OnboardingForm />
        </div>
      </section>
    </main>
  );
}
