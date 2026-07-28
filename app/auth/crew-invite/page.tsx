import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Camera } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AcceptCrewInvitation } from "@/features/auth/accept-crew-invitation";

export const metadata: Metadata = {
  title: "Crew assignment · StudioHub",
  description: "Open a secure, project-scoped photography assignment.",
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
          <ArrowLeft size={16} /> StudioHub
        </Link>
        <div className="auth-quote">
          <Logo />
          <blockquote>
            Review the role, logistics, compensation visibility, and required
            documents before accepting a photography assignment.
          </blockquote>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">Secure crew access</span>
          <h1>
            <Camera size={24} /> Open your assignment
          </h1>
          <p>
            Access is limited to the invited job and can be revoked by the
            studio.
          </p>
          {token.length >= 32 ? (
            <AcceptCrewInvitation token={token} />
          ) : (
            <p className="form-error">This assignment link is incomplete.</p>
          )}
        </div>
      </section>
    </main>
  );
}
