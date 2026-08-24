import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { SignInForm } from "@/features/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your StudioCue photography operations workspace.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // An invitation is one way a client arrives here; following "Review
  // proposal" from a studio's email is another, and that one showed them
  // "Sign in to your studio" — a page addressed to somebody else, on a
  // product they have never heard of.
  const fromInvitation = next?.startsWith("/auth/client-invite?token=") ?? false;
  const isClientArrival = fromInvitation || (next?.startsWith("/client") ?? false);
  const backHref = fromInvitation && next ? next : "/";
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link href={backHref} className="auth-back">
          <ArrowLeft size={16} /> {fromInvitation ? "Back to invitation" : "Back to StudioCue"}
        </Link>
        <div className="auth-quote">
          <Logo />
          <blockquote>
            {isClientArrival
              ? "Your studio invited you to one secure place for project details, next steps, schedules, and delivery."
              : "“I can see exactly what’s ready, what’s blocked, and who owns the next move—without opening six different tools.”"}
          </blockquote>
          {isClientArrival ? (
            <div className="quote-author client-auth-assurance">
              <span><CircleCheck size={17} /></span>
              <div>
                <strong>Project-specific access</strong>
                <small>Only records shared with your client account are visible.</small>
              </div>
            </div>
          ) : (
            <div className="quote-author">
              <span>AM</span>
              <div>
                <strong>Alex Morgan</strong>
                <small>Owner, Alder &amp; Muse Photography</small>
              </div>
            </div>
          )}
        </div>
        <div className="auth-trust">
          <span><CircleCheck size={15} /> {isClientArrival ? "Exact-email verification" : "Tenant-isolated data"}</span>
          <span><CircleCheck size={15} /> {isClientArrival ? "Revocable studio access" : "Audited actions"}</span>
          <span><CircleCheck size={15} /> {isClientArrival ? "No subscription required" : "Secure provider connections"}</span>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="mobile-auth-logo"><Logo /></div>
        {fromInvitation ? (
          <Link className="mobile-client-auth-back" href={backHref}>
            <ArrowLeft size={15} /> Back to invitation
          </Link>
        ) : null}
        <div className="auth-form-wrap">
          <span className="eyebrow">{isClientArrival ? "Client portal access" : "Welcome back"}</span>
          <h1>{isClientArrival ? "Sign in to open your project" : "Sign in to your studio"}</h1>
          <p>
            {isClientArrival
              ? "Use the exact email address that received the invitation. We’ll return you to the project automatically."
              : "Continue to your projects, clients, and operations workspace."}
          </p>
          <SignInForm intent={isClientArrival ? "client" : "studio"} next={next} />
        </div>
        <p className="auth-legal">
          By continuing, you agree to our <Link href="/terms">Terms</Link> and{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>
    </main>
  );
}
