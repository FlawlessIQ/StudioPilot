import type { Metadata } from "next";
import { AcceptClientInvitation } from "@/features/auth/accept-client-invitation";

export const metadata: Metadata = {
  title: "Open your client portal",
  // Fixed at build time: the same page opens a DJ's, a makeup artist's and a
  // hair stylist's client portal (app/client/layout.tsx says the same).
  description: "Activate secure access to your project.",
};

export default async function ClientInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; next?: string; studio?: string }>;
}) {
  const { token, next, studio } = await searchParams;
  return <AcceptClientInvitation landing={next} studioId={studio} token={token ?? ""} />;
}
