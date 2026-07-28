import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { AcceptClientInvitation } from "@/features/auth/accept-client-invitation";

export const metadata: Metadata = { title: "Activate client portal" };

export default async function ClientInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Secure client access</p>
        <h1>Activate your project portal</h1>
        <p>Review project details, complete questionnaires, approve schedules, and access delivery links.</p>
        <p className="auth-security"><ShieldCheck size={16} /> Access is limited to the invited project and can be revoked by the studio.</p>
        <AcceptClientInvitation token={token} />
      </section>
    </main>
  );
}
