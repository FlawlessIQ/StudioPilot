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
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link href="/" className="auth-back">
          <ArrowLeft size={16} /> Back to StudioCue
        </Link>
        <div className="auth-quote">
          <Logo />
          <blockquote>
            “I can see exactly what’s ready, what’s blocked, and who owns the next
            move—without opening six different tools.”
          </blockquote>
          <div className="quote-author">
            <span>AM</span>
            <div>
              <strong>Alex Morgan</strong>
              <small>Owner, Alder &amp; Muse Photography</small>
            </div>
          </div>
        </div>
        <div className="auth-trust">
          <span><CircleCheck size={15} /> Tenant-isolated data</span>
          <span><CircleCheck size={15} /> Audited actions</span>
          <span><CircleCheck size={15} /> Secure provider connections</span>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="mobile-auth-logo"><Logo /></div>
        <div className="auth-form-wrap">
          <span className="eyebrow">Welcome back</span>
          <h1>Sign in to your studio</h1>
          <p>Continue to your projects, clients, and operations workspace.</p>
          <SignInForm next={next} />
        </div>
        <p className="auth-legal">
          By continuing, you agree to our <Link href="/terms">Terms</Link> and{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>
    </main>
  );
}
