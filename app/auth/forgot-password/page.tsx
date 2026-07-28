import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Request a secure StudioCue password reset link.",
};

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page auth-action-page">
      <section className="auth-brand-panel auth-security-panel">
        <Link className="auth-back" href="/auth/login">
          <ArrowLeft size={16} /> Back to sign in
        </Link>
        <div className="auth-quote">
          <Logo />
          <span className="auth-feature-icon">
            <LockKeyhole />
          </span>
          <blockquote>Secure account recovery without exposing whether an email is registered.</blockquote>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="mobile-auth-logo"><Logo /></div>
        <div className="auth-form-wrap">
          <span className="eyebrow">Account recovery</span>
          <h1>Reset your password</h1>
          <p>We’ll send a private, single-use reset link in a branded StudioCue email.</p>
          <ForgotPasswordForm />
        </div>
      </section>
    </main>
  );
}
