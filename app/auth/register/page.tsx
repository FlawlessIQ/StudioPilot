import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { RegisterForm } from "@/features/auth/register-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a verified StudioCue account.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const isClientInvite = next?.startsWith("/auth/client-invite?token=") ?? false;
  const backHref = isClientInvite && next ? next : "/";
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link href={backHref} className="auth-back">
          <ArrowLeft size={16} />
          {isClientInvite ? "Back to invitation" : "Back to StudioCue"}
        </Link>
        <div className="auth-quote">
          <Logo />
          <blockquote>
            {isClientInvite
              ? "Create one secure client login, then StudioCue will connect the exact project your studio invited you to."
              : "Start with a calm operating system for every project—not another disconnected tool."}
          </blockquote>
        </div>
        <div className="auth-trust">
          <span>
            <CircleCheck size={15} />{" "}
            {isClientInvite ? "Free client access" : "14-day Solo trial"}
          </span>
          <span>
            <CircleCheck size={15} /> No card required
          </span>
          <span>
            <CircleCheck size={15} /> Verified email required
          </span>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="mobile-auth-logo">
          <Logo />
        </div>
        {isClientInvite ? (
          <Link className="mobile-client-auth-back" href={backHref}>
            <ArrowLeft size={15} /> Back to invitation
          </Link>
        ) : null}
        <div className="auth-form-wrap">
          <span className="eyebrow">
            {isClientInvite ? "Secure client access" : "Start your trial"}
          </span>
          <h1>
            {isClientInvite ? "Create your client access" : "Create your account"}
          </h1>
          <p>
            {isClientInvite
              ? "Use the email that received the invitation. After verification, your project will connect automatically."
              : "Verify your work email, then set up your own private studio."}
          </p>
          <RegisterForm
            intent={isClientInvite ? "client" : "studio"}
            next={next}
          />
        </div>
        <p className="auth-legal">
          By continuing, you agree to our <Link href="/terms">Terms</Link> and{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>
    </main>
  );
}
