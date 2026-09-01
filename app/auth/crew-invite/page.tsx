import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Camera } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AcceptCrewInvitation } from "@/features/auth/accept-crew-invitation";

export const metadata: Metadata = {
  title: "Crew invitation",
  description: "Accept a secure invitation from a photography studio.",
};

export default async function CrewInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link href="/" className="auth-back">
          <ArrowLeft size={16} /> StudioCue
        </Link>
        <div className="auth-quote">
          <Logo />
          <blockquote>
            Join a studio&rsquo;s crew, or review the role, logistics and
            required documents of a specific assignment.
          </blockquote>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">Secure crew access</span>
          <h1>
            <Camera size={24} /> Open your invitation
          </h1>
          <p>
            Access stays limited to what the studio invites you to, and can be
            revoked by them at any time.
          </p>
          {token.length >= 32 ? (
            <AcceptCrewInvitation token={token} />
          ) : (
            <p className="form-error">This invitation link is incomplete.</p>
          )}
        </div>
      </section>
    </main>
  );
}
