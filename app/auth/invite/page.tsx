import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AcceptInvitation } from "@/features/auth/accept-invitation";

export const metadata: Metadata = {
  title: "Accept invitation · StudioHub",
  description: "Accept secure, tenant-scoped StudioHub workspace access.",
};

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link href="/" className="auth-back">
          <ArrowLeft size={16} /> StudioHub
        </Link>
        <div className="auth-quote">
          <Logo />
          <blockquote>
            Join one studio workspace with a role-specific, revocable access
            boundary.
          </blockquote>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">Secure invitation</span>
          <h1>Accept workspace access</h1>
          <p>
            <ShieldCheck size={16} /> Invitation links expire after seven days
            and can be used only by the invited verified email.
          </p>
          {token.length >= 32 ? (
            <AcceptInvitation token={token} />
          ) : (
            <p className="form-error">This invitation link is incomplete.</p>
          )}
        </div>
      </section>
    </main>
  );
}
