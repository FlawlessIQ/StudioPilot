"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  LockKeyhole,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { Logo } from "@/components/brand/logo";
import { requestBrandedAuthEmail } from "@/lib/auth/email-client";
import {
  runClientInvitation,
  type ClientInvitationPreview,
} from "@/lib/client/invitation-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

type ActivationState =
  | "idle"
  | "connecting"
  | "accepted"
  | "error";

const previewFallback: ClientInvitationPreview = {
  status: "pending",
  expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  studioName: "Aperture & Light Studio",
  projectName: "Your photography project",
  eventDate: null,
  brandAccentColor: "#345c46",
  brandLogoUrl: null,
  maskedEmail: "yo••••@example.com",
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
  }).format(date);
}

function friendlyError(message: string) {
  if (message.includes("INVITED_EMAIL_MISMATCH")) {
    return "This invitation belongs to a different email address. Sign out and use the email shown on this invitation.";
  }
  if (message.includes("INVITATION_EXPIRED")) {
    return "This invitation has expired. Ask the studio to send a fresh link.";
  }
  if (message.includes("INVITATION_ALREADY_USED")) {
    return "This invitation has already been activated by another account. Contact the studio if you need help.";
  }
  if (message.includes("CLIENT_ALREADY_LINKED")) {
    return "This client profile is already connected to another account. Contact the studio for help.";
  }
  return "We couldn’t connect your project just yet. Please try again or ask the studio to resend the invitation.";
}

export function AcceptClientInvitation({ token }: { token: string }) {
  const router = useRouter();
  const acceptStarted = useRef(false);
  const [authResolved, setAuthResolved] = useState(!authIsLive);
  const [user, setUser] = useState<User | null>(null);
  const [preview, setPreview] = useState<ClientInvitationPreview | null>(
    authIsLive ? null : previewFallback,
  );
  const [previewError, setPreviewError] = useState("");
  const [activation, setActivation] = useState<ActivationState>("idle");
  const [message, setMessage] = useState("");
  const [verificationState, setVerificationState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  const next = `/auth/client-invite?token=${encodeURIComponent(token)}`;
  const loginHref = `/auth/login?next=${encodeURIComponent(next)}`;
  const registerHref = `/auth/register?next=${encodeURIComponent(next)}`;
  const eventDate = formatDate(preview?.eventDate ?? null);

  useEffect(() => {
    if (!authIsLive) return;
    return onAuthStateChanged(getFirebaseClient().auth, (currentUser) => {
      setUser(currentUser);
      setAuthResolved(true);
    });
  }, []);

  useEffect(() => {
    if (!token || token.length < 32) {
      queueMicrotask(() =>
        setPreviewError(
          "This invitation link is incomplete. Ask the studio to resend it.",
        ),
      );
      return;
    }
    if (!authIsLive) return;
    let active = true;
    void runClientInvitation({
      type: "preview",
      idempotencyKey: crypto.randomUUID(),
      input: { token },
    })
      .then((result) => {
        if (!active) return;
        setPreview(result as ClientInvitationPreview);
      })
      .catch(() => {
        if (active) {
          setPreviewError(
            "This invitation is no longer available. Ask the studio to send a new secure link.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (
      !user?.emailVerified ||
      !preview ||
      !["pending", "accepted"].includes(preview.status) ||
      acceptStarted.current
    ) {
      return;
    }
    acceptStarted.current = true;
    queueMicrotask(() => setActivation("connecting"));
    void runClientInvitation({
      type: "accept",
      idempotencyKey: crypto.randomUUID(),
      input: { token },
    })
      .then((result) => {
        const tenantId =
          typeof result.tenantId === "string" ? result.tenantId : null;
        if (tenantId) {
          window.localStorage.setItem("studiohub.activeTenantId", tenantId);
        }
        setActivation("accepted");
        setMessage("Your secure project portal is ready.");
        router.replace("/client");
      })
      .catch((caught: unknown) => {
        setActivation("error");
        setMessage(
          friendlyError(
            caught instanceof Error ? caught.message : "ACTIVATION_FAILED",
          ),
        );
      });
  }, [preview, router, token, user]);

  async function resendVerification() {
    if (!user?.email) return;
    setVerificationState("sending");
    try {
      await requestBrandedAuthEmail({
        type: "emailVerification",
        idempotencyKey: crypto.randomUUID(),
        input: { email: user.email, next },
      });
      setVerificationState("sent");
    } catch {
      setVerificationState("error");
    }
  }

  async function switchAccount() {
    if (authIsLive) await signOut(getFirebaseClient().auth);
    router.replace(loginHref);
  }

  const style = {
    "--invite-accent": preview?.brandAccentColor ?? "#345c46",
  } as CSSProperties;

  return (
    <main className="client-invite-page" style={style}>
      <header className="client-invite-header">
        <Logo />
        <span>
          <LockKeyhole aria-hidden="true" size={15} />
          Secure client access
        </span>
      </header>

      <div className="client-invite-layout">
        <section className="client-invite-context">
          <span className="client-invite-kicker">A private invitation from</span>
          <div className="client-invite-studio">
            {preview?.brandLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={preview.brandLogoUrl} />
            ) : (
              <span aria-hidden="true">
                {(preview?.studioName ?? "Studio").slice(0, 1).toUpperCase()}
              </span>
            )}
            <strong>{preview?.studioName ?? "Your photography studio"}</strong>
          </div>
          <h1>Everything for your project, in one calm place.</h1>
          <p className="client-invite-intro">
            Review details, complete questionnaires, approve schedules, and
            access delivery links without searching through email threads.
          </p>
          <div className="client-invite-project">
            <span>Project</span>
            <strong>{preview?.projectName ?? "Loading your project…"}</strong>
            {eventDate ? (
              <small>
                <CalendarDays aria-hidden="true" size={15} />
                {eventDate}
              </small>
            ) : null}
          </div>
          <ul className="client-invite-assurances">
            <li>
              <ShieldCheck aria-hidden="true" />
              <span>
                <strong>Private by default</strong>
                Only the project named in this invitation is shared.
              </span>
            </li>
            <li>
              <LockKeyhole aria-hidden="true" />
              <span>
                <strong>Verified access</strong>
                Your invited email is checked before access is granted.
              </span>
            </li>
          </ul>
        </section>

        <section className="client-invite-card">
          {previewError ? (
            <div className="client-invite-state" role="alert">
              <span className="client-invite-state-icon is-warning">
                <LockKeyhole />
              </span>
              <p className="eyebrow">Invitation unavailable</p>
              <h2>Ask your studio for a new link</h2>
              <p>{previewError}</p>
              <Link className="button button-dark" href="/">
                Visit StudioCue
              </Link>
            </div>
          ) : !preview || !authResolved ? (
            <div className="client-invite-state" role="status">
              <LoaderCircle className="spin" />
              <h2>Opening your invitation</h2>
              <p>We’re checking the secure link and preparing your project.</p>
            </div>
          ) : preview.status === "expired" || preview.status === "revoked" ? (
            <div className="client-invite-state" role="alert">
              <span className="client-invite-state-icon is-warning">
                <LockKeyhole />
              </span>
              <p className="eyebrow">Link no longer active</p>
              <h2>Request a fresh invitation</h2>
              <p>
                For your security, invitation links expire and can be revoked.
                Ask {preview.studioName} to send a new one.
              </p>
            </div>
          ) : activation === "connecting" ? (
            <div className="client-invite-state" role="status">
              <LoaderCircle className="spin" />
              <p className="eyebrow">Verified</p>
              <h2>Connecting your project</h2>
              <p>
                We’re securely linking your account to {preview.studioName}.
              </p>
            </div>
          ) : activation === "accepted" ? (
            <div className="client-invite-state" role="status">
              <span className="client-invite-state-icon">
                <CheckCircle2 />
              </span>
              <p className="eyebrow">Access ready</p>
              <h2>{message}</h2>
              <p>Taking you to your project now.</p>
              <Link className="button button-dark" href="/client">
                Open client portal
              </Link>
            </div>
          ) : activation === "error" ? (
            <div className="client-invite-state" role="alert">
              <span className="client-invite-state-icon is-warning">
                <LockKeyhole />
              </span>
              <p className="eyebrow">Account not connected</p>
              <h2>Let’s use the invited email</h2>
              <p>{message}</p>
              <p className="client-invite-email">
                Invitation sent to <strong>{preview.maskedEmail}</strong>
              </p>
              <button
                className="button button-dark"
                onClick={() => void switchAccount()}
                type="button"
              >
                Sign in with another account
              </button>
            </div>
          ) : !user ? (
            <div className="client-invite-state">
              <p className="eyebrow">Your project portal</p>
              <h2>Continue with your invited email</h2>
              <p>
                Sign in or create a free client account using{" "}
                <strong>{preview.maskedEmail}</strong>. You will return here
                automatically to finish connecting.
              </p>
              <div className="client-invite-actions">
                <Link className="button button-dark" href={loginHref}>
                  Sign in to continue
                </Link>
                <Link className="button button-secondary" href={registerHref}>
                  Create client access
                </Link>
              </div>
              <small className="client-invite-footnote">
                No subscription or studio setup is required.
              </small>
            </div>
          ) : !user.emailVerified ? (
            <div className="client-invite-state">
              <span className="client-invite-state-icon">
                <MailCheck />
              </span>
              <p className="eyebrow">One security step</p>
              <h2>Verify your email</h2>
              <p>
                Open the verification email sent to <strong>{user.email}</strong>.
                The link will bring you back to this project.
              </p>
              <button
                className="button button-dark"
                disabled={verificationState === "sending"}
                onClick={() => void resendVerification()}
                type="button"
              >
                {verificationState === "sending" ? (
                  <LoaderCircle className="spin" />
                ) : verificationState === "sent" ? (
                  "Verification email sent"
                ) : (
                  "Resend verification email"
                )}
              </button>
              {verificationState === "error" ? (
                <p className="form-error">
                  We couldn’t resend it. Please wait a moment and try again.
                </p>
              ) : null}
              <button
                className="client-invite-text-button"
                onClick={() => void switchAccount()}
                type="button"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <div className="client-invite-state" role="status">
              <LoaderCircle className="spin" />
              <h2>Preparing secure access</h2>
              <p>Your verified account is being connected.</p>
            </div>
          )}
        </section>
      </div>
      <footer className="client-invite-footer">
        <ShieldCheck aria-hidden="true" size={15} />
        Access is encrypted, project-specific, and revocable by the studio.
      </footer>
    </main>
  );
}
