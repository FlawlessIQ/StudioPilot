import { Logo } from "@/components/brand/logo";
import { OnboardingForm } from "@/features/auth/onboarding-form";
export default function OnboardingPage(){return <main className="auth-page"><section className="auth-brand-panel"><div className="auth-quote"><Logo/><blockquote>Your studio gets its own private workspace, and a trial that starts the moment you do.</blockquote></div></section><section className="auth-form-panel"><div className="auth-form-wrap"><OnboardingForm/></div></section></main>}
