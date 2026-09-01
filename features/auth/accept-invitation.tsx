"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, LoaderCircle, Users } from "lucide-react";
import { InvitationJoin } from "@/features/auth/invitation-join";
import { runMembershipCommand } from "@/lib/memberships/command-client";

/**
 * Accepting workspace access from a studio's invitation.
 *
 * Sent people to `/auth/login` or `/auth/register` before, neither of which
 * knows which address was invited — see features/auth/invitation-join.tsx for
 * what that cost and why all three invitation types now share one form.
 */
type Preview = {
  studioName: string;
  email: string;
  role: string;
  hasAccount: boolean;
  expired: boolean;
};

const roleNames: Record<string, string> = {
  studio_admin: "an administrator",
  studio_coordinator: "a coordinator",
  studio_photographer: "a photographer",
  staff_photographer: "a photographer",
};

export function AcceptInvitation({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let active = true;
    void runMembershipCommand({
      type: "previewInvitation",
      input: { token },
    })
      .then((value) => active && setPreview(value as unknown as Preview))
      .catch((caught: unknown) =>
        active
          ? setPreviewError(
              invitationErrorMessage(
                caught instanceof Error ? caught.message : "",
              ),
            )
          : null,
      );
    return () => {
      active = false;
    };
  }, [token]);

  if (previewError)
    return (
      <div className="invite-actions">
        <p className="form-error" role="status">
          {previewError}
        </p>
      </div>
    );

  if (!preview)
    return (
      <div className="invite-actions">
        <LoaderCircle className="spin" />
        <p>Opening your invitation…</p>
      </div>
    );

  if (preview.expired)
    return (
      <div className="invite-actions">
        <p className="form-error">
          This invitation is no longer open. Ask {preview.studioName} to send a
          new one.
        </p>
      </div>
    );

  if (accepted)
    return (
      <div className="invite-actions">
        <CheckCircle2 />
        <p>
          You have access to {preview.studioName}&rsquo;s workspace. Everything
          you can see and change is scoped to the role they gave you.
        </p>
        <Link className="button button-dark" href="/studio">
          Open the workspace
        </Link>
      </div>
    );

  return (
    <InvitationJoin
      intro={
        <p>
          <Users />
          <strong>{preview.studioName}</strong> invited you to their workspace
          {roleNames[preview.role] ? ` as ${roleNames[preview.role]}` : ""}.
        </p>
      }
      onAccept={async () => {
        await runMembershipCommand({
          type: "acceptInvitation",
          input: { token },
        });
        setAccepted(true);
      }}
      preview={preview}
      translateError={invitationErrorMessage}
    />
  );
}

function invitationErrorMessage(code?: string) {
  switch (code) {
    case "INVITATION_EXPIRED":
      return "This invitation has expired. Ask the studio to send a new one.";
    case "INVITATION_ALREADY_USED":
      return "This invitation is already linked to another account. Ask the studio to check the address on file, then resend.";
    case "INVITATION_NOT_FOUND":
      return "This link is no longer valid. Ask the studio to send a new one.";
    case "INVALID_INVITATION_ROLE":
      return "The role on this invitation is not one that can be accepted. Ask the studio to send a new one.";
    case "INTERNAL_USER_LIMIT_REACHED":
      return "The studio has no seats left on its plan. Contact them before accepting.";
    case "VERIFIED_EMAIL_REQUIRED":
      return "Your account has no email address on it, so it cannot be matched to this invitation.";
    case "FORBIDDEN":
      return "This invitation cannot be accepted with this account.";
    default:
      return code && !code.includes("_")
        ? code
        : "This could not be opened. Retry once, then ask the studio to resend the invitation.";
  }
}
