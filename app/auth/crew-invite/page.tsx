import type { Metadata } from "next";
import {
  AcceptCrewInvitation,
  CrewInviteScreen,
} from "@/features/auth/accept-crew-invitation";

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
  // The whole screen is the invitation, in the studio's brand and the mobile
  // kit (docs/mobile-first-client-crew-plan-2026-09-28.md, M2).
  return token.length >= 32 ? (
    <AcceptCrewInvitation token={token} />
  ) : (
    <CrewInviteScreen preview={null}>
      <p className="kit-note" data-tone="danger" role="alert">
        This invitation link is incomplete. Open it again from the email, or ask the studio to resend it.
      </p>
    </CrewInviteScreen>
  );
}
