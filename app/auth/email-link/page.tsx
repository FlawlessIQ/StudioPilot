import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { EmailLinkAction } from "@/features/auth/email-link-action";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function EmailLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = null } = await searchParams;
  return (
    <main className="auth-page auth-action-page auth-centered-action">
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <Logo />
          <span className="eyebrow">Account security</span>
          <h1>Sign in to your portal</h1>
          <EmailLinkAction next={next} />
        </div>
      </section>
    </main>
  );
}
