import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ oobCode?: string; next?: string }>;
}) {
  const { oobCode = "", next } = await searchParams;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : null;
  const loginHref = safeNext
    ? `/auth/login?next=${encodeURIComponent(safeNext)}`
    : "/auth/login";
  return (
    <main className="auth-page auth-action-page">
      <section className="auth-brand-panel auth-security-panel">
        <Link className="auth-back" href={loginHref}>
          <ArrowLeft size={16} /> Back to sign in
        </Link>
        <div className="auth-quote">
          <Logo />
          <blockquote>
            Choose a strong password that you do not reuse anywhere else.
          </blockquote>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="mobile-auth-logo">
          <Logo />
        </div>
        <div className="auth-form-wrap">
          <span className="eyebrow">Account security</span>
          <h1>Choose a new password</h1>
          <p>Your reset link is checked before any account information is shown.</p>
          <ResetPasswordForm next={safeNext} oobCode={oobCode} />
        </div>
      </section>
    </main>
  );
}
