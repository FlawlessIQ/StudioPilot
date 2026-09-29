"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import {
  AppBar,
  Button,
  Card,
  KitRoot,
  Main,
  PoweredBy,
  Screen,
  StudioMark,
  type Studio,
} from "@/components/kit/kit";
import { InvitationJoin } from "@/features/auth/invitation-join";
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
  email: "you@example.com",
  hasAccount: false,
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
  // A switch on the exact code, like the staff and crew pages, so the test
  // that checks every refusal has words can see which are covered. The
  // substring matching this replaced quietly covered nothing it was not
  // written for, and three codes had slipped past it.
  switch (message.trim()) {
    case "INVITED_EMAIL_MISMATCH":
      return "This invitation belongs to a different email address. Sign out and use the email shown on this invitation.";
    case "INVITATION_EXPIRED":
      return "This invitation has expired. Ask the studio to send a fresh link.";
    case "INVITATION_ALREADY_USED":
      return "This invitation has already been activated by another account. Contact the studio if you need help.";
    case "INVITATION_NOT_FOUND":
      return "This link is no longer valid. Ask the studio to send a fresh one.";
    case "CLIENT_ALREADY_LINKED":
      return "This client profile is already connected to another account. Contact the studio for help.";
    case "MEMBERSHIP_ROLE_CONFLICT":
      return "This address already works at the studio in another role, so it cannot also be the client here. Ask them to invite a different address.";
    case "FORBIDDEN":
      return "This invitation cannot be opened with this account. Sign out and use the address the studio invited.";
    case "VERIFIED_EMAIL_REQUIRED":
      return "Your account has no email address on it, so it cannot be matched to this invitation.";
    default:
      return "We couldn’t connect your project just yet. Please try again or ask the studio to resend the invitation.";
  }
}

export function AcceptClientInvitation({
  token,
  landing,
}: {
  token: string;
  /** Optional in-portal path the invitation was issued for. */
  landing?: string;
}) {
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

  // Where to land once the invitation is accepted. A proposal email sends
  // the client here with next=/client/proposal, because "Review proposal"
  // should end on the proposal and not on the portal's front door. Only
  // in-portal paths are honoured, so the parameter cannot be used to
  // bounce an authenticated client somewhere else.
  const destination =
    landing && landing.startsWith("/client") && !landing.startsWith("//")
      ? landing
      : "/client";
  // Round-tripping through sign-in has to come back to this invitation,
  // carrying the destination with it.
  const next = `/auth/client-invite?token=${encodeURIComponent(token)}${
    destination === "/client" ? "" : `&next=${encodeURIComponent(destination)}`
  }`;
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

  const acceptInvitation = useCallback(async () => {
    acceptStarted.current = true;
    setActivation("connecting");
    const result = await runClientInvitation({
      type: "accept",
      idempotencyKey: crypto.randomUUID(),
      input: { token },
    });
    const tenantId =
      typeof result.tenantId === "string" ? result.tenantId : null;
    const projectId =
      typeof result.projectId === "string" ? result.projectId : null;
    if (tenantId) {
      window.localStorage.setItem("studiohub.activeTenantId", tenantId);
    }
    /**
     * Open the job this invitation was for.
     *
     * The portal opens whichever job it remembers from last time. A couple who
     * already had a job with this studio accepted an invitation to a new one
     * and landed on the old one — on a production walk, a booked wedding whose
     * contract read "complete", while the proposal they had just been sent sat
     * unopened. The invitation names its job; that is the one to show.
     */
    if (tenantId && projectId) {
      window.localStorage.setItem(
        `studiohub.activeClientProjectId.${tenantId}`,
        projectId,
      );
    }
    setActivation("accepted");
    setMessage("Your secure project portal is ready.");
    router.replace(destination);
  }, [destination, router, token]);

  useEffect(() => {
    // No longer waits on `emailVerified`. A couple arriving by invitation has
    // just proved the mailbox by holding a token that was delivered to it, and
    // the accept marks the address verified once it has matched the two — so
    // requiring it here only stranded every new account behind a second email.
    if (
      !user ||
      !preview ||
      !["pending", "accepted"].includes(preview.status) ||
      acceptStarted.current
    ) {
      return;
    }
    void acceptInvitation().catch((caught: unknown) => {
      setActivation("error");
      setMessage(
        friendlyError(
          caught instanceof Error ? caught.message : "ACTIVATION_FAILED",
        ),
      );
    });
  }, [acceptInvitation, preview, user]);

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
    // Carry the invited email across the sign-out → login round-trip so the
    // login form prefills the address the invitation is actually for, not the
    // studio account the browser just signed out of (audit-2 N2). Kept out of
    // the URL — an email in a query string is PII that ends up in logs — so it
    // rides in sessionStorage, same-origin and tab-scoped.
    if (preview?.email && typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem("studiohub.invitedEmail", preview.email);
      } catch {
        // Private-mode storage denial is non-fatal; the field just starts empty.
      }
    }
    if (authIsLive) await signOut(getFirebaseClient().auth);
    // Someone who has never set a password has nothing to sign in with, so the
    // login form is a dead end: "Forgot password" and "Email me a link" both
    // stay silent for an address with no account (deliberately — no
    // enumeration), and there is no way back to this page's own "Set a
    // password" step. Signing out is enough; this page then renders it.
    // Hit for real on a shared laptop where the studio owner was signed in.
    if (preview?.hasAccount === false) return;
    router.replace(loginHref);
  }

  const studio: Studio = {
    name: preview?.studioName ?? "Your photography studio",
    color: preview?.brandAccentColor ?? null,
    logoUrl: preview?.brandLogoUrl ?? null,
  };

  // The studio's welcome leads, in its brand and the mobile kit (M2 of
  // docs/mobile-first-client-crew-plan-2026-09-28.md). The desktop layout it
  // replaced stacked a marketing column above the form on a phone, so the
  // password field sat below the fold.
  return (
    <KitRoot studio={studio}>
      <Screen>
        <AppBar studio={studio} />
        <Main label="Your invitation">
          <div className="kit-stack" style={{ alignItems: "center", textAlign: "center", paddingTop: 12 }}>
            <StudioMark size={64} studio={studio} />
            <p className="kit-eyebrow">A private invitation from {studio.name}</p>
            <h1 className="kit-title">
              {preview?.projectName ? `Welcome to ${preview.projectName}` : "Welcome"}
            </h1>
            {eventDate ? (
              <p className="kit-body">
                <CalendarDays aria-hidden="true" size={15} /> {eventDate}
              </p>
            ) : null}
            <p className="kit-body">
              Your proposal, agreement, plans and photos, in one place.
            </p>
          </div>

          {previewError ? (
            <Card>
              <p className="kit-eyebrow">Invitation unavailable</p>
              <h2 className="kit-section">Ask your studio for a new link</h2>
              <p className="kit-body" role="alert">{previewError}</p>
            </Card>
          ) : !preview || !authResolved ? (
            <Card>
              <p className="kit-body" role="status">
                <LoaderCircle aria-hidden="true" className="spin" size={18} /> Opening your invitation…
              </p>
            </Card>
          ) : preview.status === "expired" || preview.status === "revoked" ? (
            <Card>
              <p className="kit-eyebrow">Link no longer active</p>
              <h2 className="kit-section">Request a fresh invitation</h2>
              <p className="kit-body" role="alert">
                For your security, invitation links expire and can be revoked.
                Ask {preview.studioName}{" "} to send a new one.
              </p>
            </Card>
          ) : activation === "connecting" ? (
            <Card>
              <p className="kit-body" role="status">
                <LoaderCircle aria-hidden="true" className="spin" size={18} /> Linking your account to{" "}
                {preview.studioName}…
              </p>
            </Card>
          ) : activation === "accepted" ? (
            <Card tone="accent">
              <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
                <CheckCircle2 aria-hidden="true" size={14} /> Access ready
              </p>
              <h2 className="kit-section">{message}</h2>
              <p className="kit-body" role="status">Taking you to your project now.</p>
              <Button href="/client">Open your portal</Button>
            </Card>
          ) : activation === "error" ? (
            <Card>
              <p className="kit-eyebrow">Account not connected</p>
              <h2 className="kit-section">Let’s use the invited email</h2>
              <p className="kit-body" role="alert">{message}</p>
              <p className="kit-caption">
                Invitation sent to <strong>{preview.maskedEmail}</strong>
              </p>
              <Button onClick={() => void switchAccount()} variant="dark">
                {preview.hasAccount === false
                  ? "Continue and set your password"
                  : "Sign in with another account"}
              </Button>
            </Card>
          ) : !user ? (
            <Card>
              {/*
                Was two links to the generic auth pages, which do not know
                which address was invited — so a couple had to retype the one
                their photographer had typed for them, exactly, then verify it
                by a second email. Both are gone: the address comes from the
                invitation and the token is the verification.
              */}
              <InvitationJoin
                intro={
                  <p>
                    <strong>{preview.studioName}</strong>{" "}invited you to the
                    portal for {preview.projectName}.
                  </p>
                }
                onAccept={acceptInvitation}
                preview={{
                  studioName: preview.studioName,
                  email: preview.email,
                  hasAccount: preview.hasAccount,
                }}
                translateError={friendlyError}
              />
            </Card>
          ) : !user.emailVerified ? (
            <Card>
              <p className="kit-eyebrow">
                <MailCheck aria-hidden="true" size={14} /> One security step
              </p>
              <h2 className="kit-section">Verify your email</h2>
              <p className="kit-body">
                Open the verification email sent to <strong>{user.email}</strong>.
                The link will bring you back to this project.
              </p>
              <Button
                disabled={verificationState === "sending"}
                onClick={() => void resendVerification()}
              >
                {verificationState === "sending" ? (
                  <LoaderCircle aria-hidden="true" className="spin" size={18} />
                ) : verificationState === "sent" ? (
                  "Verification email sent"
                ) : (
                  "Resend verification email"
                )}
              </Button>
              {verificationState === "error" ? (
                <p className="kit-error">
                  We couldn’t resend it. Please wait a moment and try again.
                </p>
              ) : null}
              <Button onClick={() => void switchAccount()} variant="secondary">
                Use a different email
              </Button>
            </Card>
          ) : (
            <Card>
              <p className="kit-body" role="status">
                <LoaderCircle aria-hidden="true" className="spin" size={18} /> Preparing secure access…
              </p>
            </Card>
          )}

          <p className="kit-caption" style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            <ShieldCheck aria-hidden="true" size={15} />
            Private to your project, and revocable by the studio.
          </p>
          <PoweredBy />
        </Main>
      </Screen>
    </KitRoot>
  );
}
