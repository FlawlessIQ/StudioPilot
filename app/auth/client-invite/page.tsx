import type { Metadata } from "next";
import { AcceptClientInvitation } from "@/features/auth/accept-client-invitation";

export const metadata: Metadata = {
  title: "Open your client portal",
  description: "Activate secure access to your photography project.",
};

export default async function ClientInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; next?: string }>;
}) {
  const { token, next } = await searchParams;
  return <AcceptClientInvitation token={token ?? ""} landing={next} />;
}
