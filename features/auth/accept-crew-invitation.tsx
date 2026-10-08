"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Camera, CheckCircle2, LoaderCircle } from "lucide-react";
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
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

/**
 * Joining a studio from an invitation, in one page.
 *
 * This used to offer "Sign in to continue" and "Create an account", both
 * pointing at the generic auth pages. Those pages do not know which address
 * was invited, and the accept refuses every address but that one — so a crew
 * member with no account had to work out that they were meant to register,
 * retype the exact address the studio had typed for them, verify it by a
 * second email, come back and refresh. Every one of those steps was a place to
 * fall out, and the first one was a guess.
 *
 * The token now resolves before anyone signs in, so the page can say who
 * invited them and at which address, and take a password inline. The address
 * is fixed, never typed: it is the one thing that must match.
 */
type Preview = {
  kind: "roster" | "assignment";
  studioName: string;
  /** The studio's colour and logo; absent from an older functions build. */
  brandAccentColor?: string | null;
  brandLogoUrl?: string | null;
  email: string;
  name: string;
  hasAccount: boolean;
  expired: boolean;
};

export function AcceptCrewInvitation({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [accepted, setAccepted] = useState<Preview["kind"] | null>(null);
  const [assignmentId, setAssignmentId] = useState("");

  useEffect(() => {
    let active = true;
    void call("crewInvitationPreview", { token })
      .then((value) => active && setPreview(value as Preview))
      .catch((caught: unknown) =>
        active
          ? setPreviewError(
              caught instanceof Error
                ? invitationErrorMessage(caught.message)
                : "This invitation could not be opened.",
            )
          : null,
      );
    return () => {
      active = false;
    };
  }, [token]);

  if (previewError)
    return (
      <CrewInviteScreen preview={null}>
        <Card>
          <p className="kit-body" role="status">{previewError}</p>
        </Card>
      </CrewInviteScreen>
    );

  if (!preview)
    return (
      <CrewInviteScreen preview={null}>
        <Card>
          <p className="kit-body" role="status">
            <LoaderCircle aria-hidden="true" className="spin" size={18} /> Opening your invitation…
          </p>
        </Card>
      </CrewInviteScreen>
    );

  if (preview.expired)
    return (
      <CrewInviteScreen preview={preview}>
        <Card>
          <p className="kit-body" role="alert">
            This invitation has expired. Ask {preview.studioName}{" "} to resend it.
          </p>
        </Card>
      </CrewInviteScreen>
    );

  if (accepted)
    return (
      <CrewInviteScreen preview={preview}>
        <Card tone="accent">
          <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
            <CheckCircle2 aria-hidden="true" size={14} /> You&rsquo;re in
          </p>
          <p className="kit-body">
            {accepted === "roster"
              ? `You're on ${preview.studioName}'s crew. Add your specialties, the dates you're free, and your documents so you're ready when they offer you a job.`
              : "The assignment is now available in your crew workspace."}
          </p>
          <Button
            href={
              accepted === "roster"
                ? "/crew/account"
                : // The offer itself, with Accept and Decline (M6).
                  `/crew/pending${assignmentId ? `?assignment=${encodeURIComponent(assignmentId)}` : ""}`
            }
          >
            {accepted === "roster" ? "Set up your profile" : "Review assignment"}
          </Button>
        </Card>
      </CrewInviteScreen>
    );

  return (
    <CrewInviteScreen preview={preview}>
    <Card>
    <InvitationJoin
      intro={
        <p>
          <Camera />
          <strong>{preview.studioName}</strong>
          {preview.kind === "roster"
            ? " added you to their crew."
            : " has an assignment for you."}
        </p>
      }
      onAccept={async () => {
        const result = (await call("crewInvitationCommand", {
          token,
          idempotencyKey: crypto.randomUUID(),
        })) as { assignmentId?: string; kind?: string };
        setAssignmentId(result.assignmentId ?? "");
        setAccepted(result.kind === "roster" ? "roster" : "assignment");
      }}
      preview={preview}
      translateError={invitationErrorMessage}
      // Pressing this does not take the job. It opens the assignment so they
      // can read the date, the role and the fee before deciding.
      verb={preview.kind === "assignment" ? "see the job" : "accept"}
    />
    </Card>
    </CrewInviteScreen>
  );
}

/**
 * The crew invitation as a phone screen in the studio's brand (M2 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md). It used to sit in the
 * studio sign-in layout, under StudioCue's logo and a quote.
 */
export function CrewInviteScreen({
  preview,
  children,
}: {
  preview: Pick<Preview, "studioName" | "brandAccentColor" | "brandLogoUrl" | "kind"> | null;
  children: ReactNode;
}) {
  const studio: Studio = {
    name: preview?.studioName ?? "Your studio",
    color: preview?.brandAccentColor ?? null,
    logoUrl: preview?.brandLogoUrl ?? null,
  };
  // Until the invitation is read (or when it cannot be), the studio is not
  // known: say "your invitation", not "Join Your studio's crew".
  return (
    <KitRoot studio={studio}>
      <Screen>
        {preview ? <AppBar studio={studio} /> : <AppBar title="Crew invitation" />}
        <Main label="Crew invitation">
          <div className="kit-stack" style={{ alignItems: "center", textAlign: "center", paddingTop: 12 }}>
            {preview ? <StudioMark size={64} studio={studio} /> : null}
            <p className="kit-eyebrow">Crew invitation</p>
            <h1 className="kit-title">
              {!preview
                ? "Your invitation"
                : preview.kind === "assignment"
                  ? "A job for you"
                  : `Join ${studio.name}’s crew`}
            </h1>
            <p className="kit-body">
              Offers, schedules and paperwork, in one place on your phone.
            </p>
          </div>
          {children}
          <p className="kit-caption" style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            <Camera aria-hidden="true" size={15} />
            {preview
              ? `You only see what ${studio.name} shares with you.`
              : "You only see what the studio shares with you."}
          </p>
          <PoweredBy />
        </Main>
      </Screen>
    </KitRoot>
  );
}

async function call(functionName: string, body: Record<string, unknown>) {
  const endpoint = process.env.NEXT_PUBLIC_CREW_FUNCTIONS_URL;
  if (!endpoint) throw new Error("Crew invitation services are unavailable.");
  const appCheckToken = await getAppCheckToken();
  const user = getFirebaseClient().auth.currentUser;
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/${functionName}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(user ? { authorization: `Bearer ${await user.getIdToken()}` } : {}),
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(invitationErrorMessage(result.error));
  return result;
}

function invitationErrorMessage(code?: string) {
  switch (code) {
    case "INVITATION_EXPIRED":
      return "This invitation has expired. Ask the studio to resend it so you receive a new secure link.";
    case "INVITED_EMAIL_MISMATCH":
      return "This link belongs to a different email address. Sign out and use the exact address the studio invited.";
    case "INVITATION_ALREADY_USED":
      return "This invitation is already linked to another account. Ask the studio to check the email on file, then resend.";
    case "INVITATION_NOT_FOUND":
      return "This link is no longer valid. Ask the studio to resend it.";
    case "VERIFIED_EMAIL_REQUIRED":
      return "Your account has no email address on it, so it cannot be matched to this invitation.";
    case "MEMBERSHIP_ROLE_CONFLICT":
      // Usually the studio's own client, not someone who "works" there
      // (GR, 2026-10-08: one inbox for the bride and the photographer).
      return "This address is already the studio's client, or on its team, so it can't also be your crew login. Ask the studio to invite you at a different address.";
    case "SUBCONTRACTOR_LIMIT_REACHED":
      return "The studio has no crew seats left on its plan. Contact the studio.";
    default:
      return code && !code.includes("_")
        ? code
        : "This could not be opened. Retry once, then ask the studio to resend the invitation.";
  }
}
