import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { VerifyEmailAction } from "@/features/auth/verify-email-action";

export const metadata: Metadata = {
  title: "Verify email",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ oobCode?: string; next?: string }>;
}) {
  const { oobCode = "", next = null } = await searchParams;
  return (
    <main className="auth-page auth-action-page auth-centered-action">
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <Logo />
          <span className="eyebrow">Account security</span>
          <h1>Confirm your email</h1>
          <VerifyEmailAction next={next} oobCode={oobCode} />
        </div>
      </section>
    </main>
  );
}
